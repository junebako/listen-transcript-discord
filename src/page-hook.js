// ページのメインワールドで動く。
// fetch をフックして保存リクエストを捉え、差分を content script へ渡す。
// Alpine の state に触る必要があるのでメインワールドに置いている。
(function () {
  const MESSAGE_TYPE = "LISTEN_TRANSCRIPT_DISCORD_CHANGES";
  const EDITOR_SAVE_PATH = "/transcript_editor/replace_segments";
  const UPDATE_BODY_PATH = "/update_body";
  const LIVEWIRE_PATH = "/livewire/update";
  const LOG_PREFIX = "[listen-transcript-discord]";

  const location_ = window.location;

  // ---- セグメントの正規化 ----------------------------------------------

  // Alpine の state では未設定の話者が -1、送信ペイロードでは null になる
  function normalizeSpeaker(value) {
    return value === null || value === undefined || value === -1 ? null : value;
  }

  function normalizeSegment(segment) {
    return {
      start: Number(segment.start),
      end: Number(segment.end),
      speaker: normalizeSpeaker(segment.speaker),
      text: String(segment.text == null ? "" : segment.text),
    };
  }

  // ---- 文字起こしエディタ: スナップショット ------------------------------

  let snapshot = null;

  function readAlpineSegments() {
    if (!window.Alpine || !window.Alpine.$data) return null;
    const root = Array.from(document.querySelectorAll("[x-data]")).find((el) =>
      el.querySelector(".segment-row"),
    );
    if (!root) return null;
    try {
      const data = window.Alpine.$data(root);
      if (!data || !Array.isArray(data.segments)) return null;
      return data.segments.map(normalizeSegment);
    } catch (e) {
      return null;
    }
  }

  function initSnapshot() {
    if (snapshot) return;
    const segments = readAlpineSegments();
    if (segments) snapshot = segments;
  }

  document.addEventListener("alpine:initialized", initSnapshot);
  document.addEventListener("DOMContentLoaded", () => {
    // alpine:initialized を取り逃した場合の保険
    setTimeout(initSnapshot, 500);
    setTimeout(initSnapshot, 2000);
  });

  // ---- エピソードページ: 編集前テキストの記憶 ----------------------------

  const segmentTexts = new Map();

  function collectSegmentTexts() {
    for (const el of document.querySelectorAll(".replaceable-content")) {
      const id = el.id;
      if (!id || id[0] !== "t") continue;
      const start = parseFloat(id.slice(1));
      if (Number.isNaN(start)) continue;
      // 編集済みのものを古い値で上書きしないよう、未記録のときだけ入れる
      if (!segmentTexts.has(start)) segmentTexts.set(start, el.textContent.trim());
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    collectSegmentTexts();
    new MutationObserver(collectSegmentTexts).observe(document.body, {
      childList: true,
      subtree: true,
    });
  });

  // ---- 差分の送出 --------------------------------------------------------

  function emit(source, changes) {
    if (!changes.length) return;
    window.postMessage(
      { type: MESSAGE_TYPE, source, changes },
      location_.origin,
    );
  }

  // ---- 各リクエストの処理 ------------------------------------------------

  function handleEditorSave(body, response) {
    const payload = JSON.parse(body);
    const next = (payload.segments || []).map(normalizeSegment);
    if (!next.length) return;

    response.then((res) => {
      if (!res.ok) return;
      // 基準がまだ無いときは記録だけして通知しない
      if (!snapshot) {
        snapshot = next;
        return;
      }
      const changes = window.ListenDiff.diffSegments(snapshot, next);
      snapshot = next;
      emit("editor", changes);
    });
  }

  function handleUpdateBody(body, response) {
    const payload = JSON.parse(body);
    const start = Number(payload.start);
    const before = segmentTexts.get(start);
    const after = String(payload.body == null ? "" : payload.body).trim();
    if (before === undefined || before === after) return;

    response.then((res) => {
      if (!res.ok) return;
      segmentTexts.set(start, after);
      emit("episode", [
        {
          kind: "edit",
          start,
          end: payload.end === undefined ? null : Number(payload.end),
          before,
          after,
        },
      ]);
    });
  }

  function handleLivewire(body, response) {
    const payload = JSON.parse(body);
    for (const component of payload.components || []) {
      const snapshot_ = JSON.parse(component.snapshot || "{}");
      const memo = snapshot_.memo || {};
      if (memo.name !== "replace-transcription-form") continue;

      const updates = component.updates || {};
      if (!updates.searchString || updates.replacementString === undefined) continue;

      const before = updates.searchString;
      const after = updates.replacementString;
      response.then((res) => {
        if (!res.ok) return;
        // 置換後はどのセグメントが変わったか分からないので記憶を捨てる
        segmentTexts.clear();
        setTimeout(collectSegmentTexts, 1000);
        emit("episode", [
          { kind: "bulk_replace", start: null, end: null, before, after },
        ]);
      });
    }
  }

  function handleRequest(url, method, body, response) {
    if (method === "PUT" && url.includes(EDITOR_SAVE_PATH)) {
      handleEditorSave(body, response);
      return;
    }
    if (method === "POST" && url.includes(UPDATE_BODY_PATH)) {
      handleUpdateBody(body, response);
      return;
    }
    if (method === "POST" && url.includes(LIVEWIRE_PATH)) {
      handleLivewire(body, response);
    }
  }

  // ---- fetch のフック ----------------------------------------------------

  const originalFetch = window.fetch;

  window.fetch = function (input, init) {
    const response = originalFetch.apply(this, arguments);
    try {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const method = String(
        (init && init.method) || (input && input.method) || "GET",
      ).toUpperCase();
      const body = init && init.body;
      if (typeof body === "string" && url) {
        handleRequest(url, method, body, response);
      }
    } catch (e) {
      console.warn(LOG_PREFIX, "リクエストの解析に失敗しました", e);
    }
    return response;
  };
})();
