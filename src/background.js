// content script から差分を受け取り、番組ごとの Discord Webhook へ送る。
importScripts("/src/message.js", "/src/settings.js");

const LOG_PREFIX = "[listen-transcript-discord]";
const MAX_RETRY_WAIT_MS = 10000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function post(webhookUrl, payload) {
  return fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function postToDiscord(webhookUrl, payload) {
  try {
    let res = await post(webhookUrl, payload);

    // レート制限に当たったら、指示された時間だけ待って一度だけやり直す
    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      const waitMs = Math.min(
        MAX_RETRY_WAIT_MS,
        Math.ceil((Number(body.retry_after) || 1) * 1000),
      );
      await sleep(waitMs);
      res = await post(webhookUrl, payload);
    }

    if (res.ok) return { ok: true };
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function handleChanges(message) {
  const settings = await ListenSettings.load();
  if (!settings.enabled) return { ok: false, skipped: "disabled" };

  const program = settings.programs[message.programSlug];
  if (!program || !program.webhookUrl) {
    return { ok: false, skipped: "unregistered" };
  }

  const payload = ListenMessage.buildDiscordPayload({
    displayName: settings.displayName,
    programLabel: program.label || message.programLabel || message.programSlug,
    episodeTitle: message.episodeTitle,
    episodeUrl: message.episodeUrl,
    source: message.source,
    changes: message.changes,
    now: new Date().toISOString(),
  });

  const result = await postToDiscord(program.webhookUrl, payload);
  if (!result.ok) console.warn(LOG_PREFIX, "送信に失敗しました", result.error);
  return result;
}

async function handleTest(message) {
  const settings = await ListenSettings.load();
  const program = settings.programs[message.programSlug];
  if (!program || !program.webhookUrl) {
    return { ok: false, error: "この番組の Webhook URL が未設定です" };
  }

  const payload = ListenMessage.buildDiscordPayload({
    displayName: settings.displayName,
    programLabel: program.label || message.programSlug,
    episodeTitle: "テスト送信",
    episodeUrl: `https://listen.style/p/${message.programSlug}`,
    source: "editor",
    changes: [
      { kind: "edit", start: 0, end: 1, before: "編集前のテキスト", after: "編集後のテキスト" },
    ],
    now: new Date().toISOString(),
  });

  return postToDiscord(program.webhookUrl, payload);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "LTD_CHANGES") {
    handleChanges(message).then(sendResponse);
    return true;
  }
  if (message.type === "LTD_TEST") {
    handleTest(message).then(sendResponse);
    return true;
  }
  return undefined;
});
