// LISTEN の URL から番組・エピソードを取り出す純粋関数。
// content script (classic script) と Node のテストの両方から使えるようにしてある。
(function (root, factory) {
  const api = factory();
  root.ListenUrl = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const HOST = "listen.style";

  function parseListenUrl(input) {
    let url;
    try {
      url = new URL(input);
    } catch (e) {
      return null;
    }

    if (url.hostname !== HOST) return null;

    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "p" || !parts[1]) return null;

    const programSlug = parts[1];
    const episodeSlug = parts[2] || null;
    if (!episodeSlug) {
      return { programSlug, episodeSlug: null, page: null, episodeUrl: null };
    }

    return {
      programSlug,
      episodeSlug,
      page: parts[3] === "transcript_editor" ? "editor" : "episode",
      episodeUrl: `${url.origin}/p/${programSlug}/${episodeSlug}`,
    };
  }

  return { parseListenUrl };
});
