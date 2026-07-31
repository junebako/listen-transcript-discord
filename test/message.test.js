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
    username: "tester",
    embeds: [
      {
        author: { name: "テスト番組" },
        title: "第1回",
        url: "https://listen.style/p/foo/bar",
        color: 0x5865f2,
        description: "1 件を編集しました",
        fields: [
          {
            name: "00:00:05 編集",
            value:
              "```diff\n- foo\n+ bar\n```\n" +
              "[▶ 00:00:05 から聴く](https://listen.style/p/foo/bar?t=5)",
          },
        ],
        footer: { text: "文字起こしエディタ" },
        timestamp: NOW,
      },
    ],
  });
});

test("種別ごとに description の文言を変える", () => {
  const cases = [
    ["edit", "2 件を編集しました"],
    ["speaker", "2 件の話者を変更しました"],
    ["merge", "2 箇所を結合しました"],
    ["split", "2 箇所を分割しました"],
    ["other", "2 件を変更しました"],
  ];

  for (const [kind, expected] of cases) {
    const changes = [
      { kind, start: 0, end: 5, before: "foo", after: "bar" },
      { kind, start: 5, end: 10, before: "foo", after: "bar" },
    ];
    const payload = buildDiscordPayload(baseInput({ changes }));
    assert.strictEqual(payload.embeds[0].description, expected, kind);
  }
});

test("種別が混在したら変更としてまとめる", () => {
  const payload = buildDiscordPayload(
    baseInput({
      changes: [
        { kind: "edit", start: 0, end: 5, before: "foo", after: "bar" },
        { kind: "merge", start: 5, end: 15, before: "foo\nbar", after: "foobar" },
      ],
    }),
  );

  assert.strictEqual(payload.embeds[0].description, "2 件を変更しました");
});

test("11件以上の変更は10件に切り詰めて残りを description に書く", () => {
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

  const payload = buildDiscordPayload(baseInput({ changes }));

  assert.strictEqual(payload.embeds[0].fields.length, 10);
  assert.strictEqual(
    payload.embeds[0].description,
    "12 件を編集しました (ほか 2 件は省略)",
  );
});

test("長すぎるテキストは切り詰める", () => {
  const payload = buildDiscordPayload(
    baseInput({
      changes: [
        {
          kind: "edit",
          start: 0,
          end: 5,
          before: "a".repeat(1000),
          after: "b".repeat(1000),
        },
      ],
    }),
  );

  const value = payload.embeds[0].fields[0].value;
  assert.ok(value.length <= 1024, `value が長すぎる: ${value.length}`);
  assert.ok(value.includes("…"), "省略記号が入っていない");
});

test("話者が未設定のときは (未設定) と表示する", () => {
  const payload = buildDiscordPayload(
    baseInput({
      changes: [
        { kind: "speaker", start: 0, end: 5, before: null, after: "speaker-1" },
      ],
    }),
  );

  assert.match(payload.embeds[0].fields[0].value, /- \(未設定\)\n\+ speaker-1/);
});

test("一括置換は時刻を持たないので見出しとリンクを省く", () => {
  const payload = buildDiscordPayload(
    baseInput({
      source: "episode",
      changes: [
        { kind: "bulk_replace", start: null, end: null, before: "foo", after: "bar" },
      ],
    }),
  );

  const field = payload.embeds[0].fields[0];
  assert.strictEqual(field.name, "一括置換");
  assert.strictEqual(field.value, "```diff\n- foo\n+ bar\n```");
  assert.strictEqual(payload.embeds[0].description, "1 件を一括置換しました");
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

test("表示名が空なら username を含めない", () => {
  const payload = buildDiscordPayload(
    baseInput({
      displayName: "",
      changes: [
        { kind: "edit", start: 5, end: 10, before: "foo", after: "bar" },
      ],
    }),
  );

  assert.ok(!("username" in payload));
});
