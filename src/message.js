// 差分から Discord Webhook のペイロードを組み立てる純粋関数。
// content script (classic script) と Node のテストの両方から使えるようにしてある。
(function (root, factory) {
  const api = factory();
  root.ListenMessage = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const EMBED_COLOR = 0x5865f2;
  const MAX_FIELDS = 10;
  const MAX_FIELD_VALUE = 1024;

  const KIND_LABELS = {
    edit: "編集",
    speaker: "話者変更",
    merge: "結合",
    split: "分割",
    bulk_replace: "一括置換",
    other: "変更",
  };

  const KIND_DESCRIPTIONS = {
    edit: (n) => `${n} 件を編集しました`,
    speaker: (n) => `${n} 件の話者を変更しました`,
    merge: (n) => `${n} 箇所を結合しました`,
    split: (n) => `${n} 箇所を分割しました`,
    bulk_replace: (n) => `${n} 件を一括置換しました`,
    other: (n) => `${n} 件を変更しました`,
  };

  const SOURCE_LABELS = {
    editor: "文字起こしエディタ",
    episode: "エピソードページ",
  };

  function formatTimestamp(seconds) {
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
  }

  function displayText(value) {
    if (value === null || value === undefined) return "(未設定)";
    if (value === "") return "(空)";
    return String(value);
  }

  function truncate(text, max) {
    return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
  }

  function prefixLines(text, prefix) {
    return text
      .split("\n")
      .map((line) => `${prefix} ${line}`)
      .join("\n");
  }

  // 一括置換のように特定の時刻に紐づかない変更もある
  function hasTime(change) {
    return typeof change.start === "number";
  }

  function buildFieldValue(change, episodeUrl) {
    const link = hasTime(change)
      ? `[▶ ${formatTimestamp(change.start)} から聴く](${episodeUrl}?t=${Math.floor(change.start)})`
      : null;
    // diff ブロックの囲みと行頭記号のぶんを見込んで予算を取る
    const overhead = "```diff\n\n\n```\n".length + (link ? link.length : 0) + 8;
    const budget = Math.max(40, MAX_FIELD_VALUE - overhead);
    const half = Math.floor(budget / 2);

    const before = truncate(displayText(change.before), half);
    const after = truncate(displayText(change.after), half);
    const lines = [
      "```diff",
      prefixLines(before, "-"),
      prefixLines(after, "+"),
      "```",
    ];
    if (link) lines.push(link);
    const value = lines.join("\n");

    return value.length <= MAX_FIELD_VALUE
      ? value
      : `${value.slice(0, MAX_FIELD_VALUE - 1)}…`;
  }

  function buildDescription(changes, omittedCount) {
    const kinds = new Set(changes.map((c) => c.kind));
    const describe =
      kinds.size === 1
        ? KIND_DESCRIPTIONS[[...kinds][0]] || KIND_DESCRIPTIONS.other
        : KIND_DESCRIPTIONS.other;

    const base = describe(changes.length);
    return omittedCount > 0 ? `${base} (ほか ${omittedCount} 件は省略)` : base;
  }

  function buildDiscordPayload(input) {
    const {
      displayName,
      programLabel,
      episodeTitle,
      episodeUrl,
      source,
      changes,
      now,
    } = input;

    const shown = changes.slice(0, MAX_FIELDS);
    const omitted = changes.length - shown.length;

    const embed = {
      author: { name: programLabel },
      title: episodeTitle,
      url: episodeUrl,
      color: EMBED_COLOR,
      description: buildDescription(changes, omitted),
      fields: shown.map((change) => {
        const label = KIND_LABELS[change.kind] || KIND_LABELS.other;
        return {
          name: hasTime(change)
            ? `${formatTimestamp(change.start)} ${label}`
            : label,
          value: buildFieldValue(change, episodeUrl),
        };
      }),
      footer: { text: SOURCE_LABELS[source] || SOURCE_LABELS.editor },
      timestamp: now,
    };

    const payload = { embeds: [embed] };
    if (displayName) payload.username = displayName;
    return payload;
  }

  return { buildDiscordPayload, formatTimestamp };
});
