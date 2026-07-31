// メインワールドで検知した差分を受け取り、拡張機能側へ橋渡しする。
// ページ情報の取得とトースト表示もここが担当する。
(function () {
  const MESSAGE_TYPE = "LISTEN_TRANSCRIPT_DISCORD_CHANGES";
  const LOG_PREFIX = "[listen-transcript-discord]";

  // ---- ページ情報 --------------------------------------------------------

  // パンくずのリンク文字列は LISTEN 側で 30 文字ほどに切り詰められる
  // (末尾が ".." になる)。同じ先へのリンクは複数あるので、最も長い表記を採る。
  function longestTextOfLinksTo(path) {
    const texts = Array.from(document.querySelectorAll(`a[href$="${path}"]`))
      .map((a) => a.textContent.trim())
      .filter(Boolean);
    if (!texts.length) return null;
    return texts.reduce((longest, t) => (t.length > longest.length ? t : longest));
  }

  function programLabel(programSlug) {
    return longestTextOfLinksTo(`/p/${programSlug}`) || programSlug;
  }

  function episodeTitle(parsed, label) {
    // 見出しには切り詰められていない全文が入っている
    const heading = document.querySelector("h1");
    if (heading && heading.textContent.trim()) return heading.textContent.trim();

    let title = document.title
      .replace(/^文字起こしエディタ - /, "")
      .replace(/ - LISTEN$/, "");
    if (label) title = title.replace(new RegExp(` - ${escapeRegExp(label)}$`), "");
    if (title) return title;

    return (
      longestTextOfLinksTo(`/p/${parsed.programSlug}/${parsed.episodeSlug}`) ||
      parsed.episodeSlug
    );
  }

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function pageInfo() {
    const parsed = window.ListenUrl.parseListenUrl(location.href);
    if (!parsed || !parsed.episodeSlug) return parsed;

    const label = programLabel(parsed.programSlug);
    return Object.assign({}, parsed, {
      programLabel: label,
      episodeTitle: episodeTitle(parsed, label),
    });
  }

  // ---- 差分の中継 --------------------------------------------------------

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== MESSAGE_TYPE) return;

    const info = pageInfo();
    if (!info || !info.episodeSlug) return;

    chrome.runtime.sendMessage(
      {
        type: "LTD_CHANGES",
        source: data.source,
        changes: data.changes,
        programSlug: info.programSlug,
        programLabel: info.programLabel,
        episodeTitle: info.episodeTitle,
        episodeUrl: info.episodeUrl,
      },
      (result) => {
        if (chrome.runtime.lastError) {
          console.warn(LOG_PREFIX, chrome.runtime.lastError.message);
          return;
        }
        if (!result || result.skipped) return;
        if (result.ok) {
          showToast(`Discord に通知しました (${data.changes.length} 件)`, false);
        } else {
          showToast(`Discord への通知に失敗しました: ${result.error}`, true);
        }
      },
    );
  });

  // ---- popup からの問い合わせ --------------------------------------------

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== "LTD_PAGE_INFO") return;
    sendResponse(pageInfo());
  });

  // ---- トースト ----------------------------------------------------------

  function showToast(text, isError) {
    const el = document.createElement("div");
    el.textContent = text;
    el.style.cssText = [
      "position:fixed",
      "bottom:80px",
      "right:20px",
      "z-index:99999",
      `background:${isError ? "#e74c3c" : "#5865F2"}`,
      "color:#fff",
      "padding:12px 16px",
      "border-radius:8px",
      "font-size:14px",
      "max-width:400px",
      "box-shadow:0 4px 12px rgba(0,0,0,0.3)",
      "transition:opacity 0.3s",
      "line-height:1.5",
    ].join(";");
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }
})();
