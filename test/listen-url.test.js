const test = require("node:test");
const assert = require("node:assert");

const { parseListenUrl } = require("../src/listen-url.js");

test("エピソードページの URL を解析する", () => {
  assert.deepStrictEqual(
    parseListenUrl("https://listen.style/p/foo-program/abc123"),
    {
      programSlug: "foo-program",
      episodeSlug: "abc123",
      page: "episode",
      episodeUrl: "https://listen.style/p/foo-program/abc123",
    },
  );
});

test("文字起こしエディタの URL を解析する", () => {
  assert.deepStrictEqual(
    parseListenUrl("https://listen.style/p/foo-program/abc123/transcript_editor"),
    {
      programSlug: "foo-program",
      episodeSlug: "abc123",
      page: "editor",
      episodeUrl: "https://listen.style/p/foo-program/abc123",
    },
  );
});

test("クエリやフラグメントが付いていても解析できる", () => {
  const parsed = parseListenUrl(
    "https://listen.style/p/foo-program/abc123?t=42#comment",
  );

  assert.strictEqual(parsed.episodeSlug, "abc123");
  assert.strictEqual(parsed.episodeUrl, "https://listen.style/p/foo-program/abc123");
});

test("番組トップは番組スラッグだけ返す", () => {
  assert.deepStrictEqual(parseListenUrl("https://listen.style/p/foo-program"), {
    programSlug: "foo-program",
    episodeSlug: null,
    page: null,
    episodeUrl: null,
  });
});

test("LISTEN 以外の URL は null を返す", () => {
  assert.strictEqual(parseListenUrl("https://example.com/p/foo/bar"), null);
});

test("LISTEN でも番組ページでなければ null を返す", () => {
  assert.strictEqual(parseListenUrl("https://listen.style/"), null);
});

test("URL として壊れていれば null を返す", () => {
  assert.strictEqual(parseListenUrl("not a url"), null);
});
