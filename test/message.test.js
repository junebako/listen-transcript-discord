const test = require("node:test");
const assert = require("node:assert");

const { buildDiscordPayload, formatTimestamp } = require("../src/message.js");

const NOW = "2026-07-31T12:00:00.000Z";

function baseInput(overrides) {
  return Object.assign(
    {
      displayName: "tester",
      programLabel: "テスト番組",
      episodeTitle: "第1回",
      episodeUrl: "https://listen.style/p/foo/bar",
      source: "editor",
      now: NOW,
      changes: [],
    },
    overrides,
  );
}

function descriptionOf(input) {
  return buildDiscordPayload(baseInput(input)).embeds[0].description;
}

test("秒数を hh:mm:ss に整形する", () => {
  assert.strictEqual(formatTimestamp(0), "00:00:00");
  assert.strictEqual(formatTimestamp(5.9), "00:00:05");
  assert.strictEqual(formatTimestamp(752), "00:12:32");
  assert.strictEqual(formatTimestamp(3725), "01:02:05");
});

test("1件の編集を embed 1つにまとめる", () => {
  const payload = buildDiscordPayload(
    baseInput({
      changes: [
        { kind: "edit", start: 5, end: 10, before: "foo", after: "bar" },
      ],
    }),
  );

  assert.deepStrictEqual(payload, {
    username: "文字起こし編集",
    embeds: [
      {
        author: { name: "テスト番組" },
        title: "第1回",
        url: "https://listen.style/p/foo/bar",
        color: 0x5865f2,
        description: [
          "testerが 1 件を編集しました",
          "",
          "[00:00:05 編集](https://listen.style/p/foo/bar?t=5)",
          "```diff",
          "- foo",
          "+ bar",
          "```",
        ].join("\n"),
        footer: { text: "文字起こしエディタ" },
        timestamp: NOW,
      },
    ],
  });
});

test("見出しはその時刻から聴けるリンクになっている", () => {
  const description = descriptionOf({
    changes: [
      { kind: "merge", start: 752, end: 800, before: "foo\nbar", after: "foobar" },
    ],
  });

  assert.ok(
    description.includes("[00:12:32 結合](https://listen.style/p/foo/bar?t=752)"),
    description,
  );
});

test("種別ごとに要約の文言を変える", () => {
  const cases = [
    ["edit", "testerが 2 件を編集しました"],
    ["speaker", "testerが 2 件の話者を変更しました"],
    ["merge", "testerが 2 箇所を結合しました"],
    ["split", "testerが 2 箇所を分割しました"],
    ["other", "testerが 2 件を変更しました"],
  ];

  for (const [kind, expected] of cases) {
    const changes = [
      { kind, start: 0, end: 5, before: "foo", after: "bar" },
      { kind, start: 5, end: 10, before: "foo", after: "bar" },
    ];
    assert.strictEqual(descriptionOf({ changes }).split("\n")[0], expected, kind);
  }
});

test("種別が混在したら変更としてまとめる", () => {
  const description = descriptionOf({
    changes: [
      { kind: "edit", start: 0, end: 5, before: "foo", after: "bar" },
      { kind: "merge", start: 5, end: 15, before: "foo\nbar", after: "foobar" },
    ],
  });

  assert.strictEqual(description.split("\n")[0], "testerが 2 件を変更しました");
});

test("11件以上の変更は10件に切り詰めて残りを要約に書く", () => {
  const changes = [];
  for (let i = 0; i < 12; i += 1) {
    changes.push({
      kind: "edit",
      start: i * 5,
      end: i * 5 + 5,
      before: "foo",
      after: "bar",
    });
  }

  const description = descriptionOf({ changes });

  assert.strictEqual(
    description.split("\n")[0],
    "testerが 12 件を編集しました (ほか 2 件は省略)",
  );
  assert.strictEqual(description.match(/```diff/g).length, 10);
});

test("長すぎるテキストは切り詰める", () => {
  const description = descriptionOf({
    changes: [
      {
        kind: "edit",
        start: 0,
        end: 5,
        before: "a".repeat(3000),
        after: "b".repeat(3000),
      },
    ],
  });

  assert.ok(description.length <= 4096, `description が長すぎる: ${description.length}`);
  assert.ok(description.includes("…"), "省略記号が入っていない");
});

test("変更が多すぎて入りきらないぶんは省略する", () => {
  const changes = [];
  for (let i = 0; i < 10; i += 1) {
    changes.push({
      kind: "edit",
      start: i * 5,
      end: i * 5 + 5,
      before: "a".repeat(400),
      after: "b".repeat(400),
    });
  }

  const description = descriptionOf({ changes });

  assert.ok(description.length <= 4096, `description が長すぎる: ${description.length}`);
  assert.match(description.split("\n")[0], /ほか \d+ 件は省略/);
});

test("話者が未設定のときは (未設定) と表示する", () => {
  const description = descriptionOf({
    changes: [
      { kind: "speaker", start: 0, end: 5, before: null, after: "speaker-1" },
    ],
  });

  assert.match(description, /- \(未設定\)\n\+ speaker-1/);
});

test("一括置換は時刻を持たないので見出しをリンクにしない", () => {
  const description = descriptionOf({
    source: "episode",
    changes: [
      { kind: "bulk_replace", start: null, end: null, before: "foo", after: "bar" },
    ],
  });

  assert.strictEqual(
    description,
    ["testerが 1 件を一括置換しました", "", "**一括置換**", "```diff", "- foo", "+ bar", "```"].join("\n"),
  );
});

test("エピソードページ由来なら footer を変える", () => {
  const payload = buildDiscordPayload(
    baseInput({
      source: "episode",
      changes: [
        { kind: "edit", start: 5, end: 10, before: "foo", after: "bar" },
      ],
    }),
  );

  assert.deepStrictEqual(payload.embeds[0].footer, {
    text: "エピソードページ",
  });
});

test("表示名が空なら要約に名前を付けない", () => {
  const payload = buildDiscordPayload(
    baseInput({
      displayName: "",
      changes: [
        { kind: "edit", start: 5, end: 10, before: "foo", after: "bar" },
      ],
    }),
  );

  assert.strictEqual(
    payload.embeds[0].description.split("\n")[0],
    "1 件を編集しました",
  );
  assert.strictEqual(payload.username, "文字起こし編集");
});
