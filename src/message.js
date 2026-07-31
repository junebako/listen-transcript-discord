// 差分から Discord Webhook のペイロードを組み立てる純粋関数。
// content script (classic script) と Node のテストの両方から使えるようにしてある。
(function (root, factory) {
  const api = factory();
  root.ListenMessage = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  // Discord での投稿者名。誰が編集したかは要約の側で伝える
  const WEBHOOK_USERNAME = "文字起こし編集";
  const EMBED_COLOR = 0x5865f2;
  const MAX_CHANGES = 10;
  const MAX_DESCRIPTION = 4096;
  // 1 件が長すぎて他の変更を押し出さないよう、変更前後それぞれに上限を設ける
  const MAX_TEXT = 400;

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

  // 見出しそのものをリンクにして、再生位置へ飛ぶための行を別に持たせない
  function buildHeading(change, episodeUrl) {
    const label = KIND_LABELS[change.kind] || KIND_LABELS.other;
    if (!hasTime(change)) return `**${label}**`;

    const at = formatTimestamp(change.start);
    return `[${at} ${label}](${episodeUrl}?t=${Math.floor(change.start)})`;
  }

  function buildBlock(change, episodeUrl) {
    const before = truncate(displayText(change.before), MAX_TEXT);
    const after = truncate(displayText(change.after), MAX_TEXT);
    return [
      buildHeading(change, episodeUrl),
      "```diff",
      prefixLines(before, "-"),
      prefixLines(after, "+"),
      "```",
    ].join("\n");
  }

  function buildSummary(changes, omittedCount, displayName) {
    const kinds = new Set(changes.map((c) => c.kind));
    const describe =
      kinds.size === 1
        ? KIND_DESCRIPTIONS[[...kinds][0]] || KIND_DESCRIPTIONS.other
        : KIND_DESCRIPTIONS.other;

    const base = describe(changes.length);
    const summary =
      omittedCount > 0 ? `${base} (ほか ${omittedCount} 件は省略)` : base;
    return displayName ? `${displayName}が ${summary}` : summary;
  }

  // 要約の文言は省略件数によって変わるので、先に本文を積んでから頭に付ける。
  // 要約の長さぶんは余裕を見て確保しておく。
  function buildDescription(changes, episodeUrl, displayName) {
    const budget = MAX_DESCRIPTION - 120;
    const blocks = [];
    let used = 0;

    for (const change of changes.slice(0, MAX_CHANGES)) {
      const block = buildBlock(change, episodeUrl);
      if (used + block.length + 2 > budget) break;
      blocks.push(block);
      used += block.length + 2;
    }

    const omitted = changes.length - blocks.length;
    const summary = buildSummary(changes, omitted, displayName);
    const body = blocks.join("\n\n");
    return body ? `${summary}\n\n${body}` : summary;
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

    return {
      username: WEBHOOK_USERNAME,
      embeds: [
        {
          author: { name: programLabel },
          title: episodeTitle,
          url: episodeUrl,
          color: EMBED_COLOR,
          description: buildDescription(changes, episodeUrl, displayName),
          footer: { text: SOURCE_LABELS[source] || SOURCE_LABELS.editor },
          timestamp: now,
        },
      ],
    };
  }

  return { buildDiscordPayload, formatTimestamp };
});
