// 今開いている LISTEN の番組をその場で登録するための画面。
(function () {
  const enabledInput = document.getElementById("enabled");
  const displayNameInput = document.getElementById("displayName");
  const programSection = document.getElementById("programSection");
  const programLabelEl = document.getElementById("programLabel");
  const programSlugEl = document.getElementById("programSlug");
  const webhookUrlInput = document.getElementById("webhookUrl");
  const saveButton = document.getElementById("save");
  const removeButton = document.getElementById("remove");
  const noticeEl = document.getElementById("notice");
  const statusEl = document.getElementById("status");

  let currentSlug = null;

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = `status${kind ? ` ${kind}` : ""}`;
    if (text) setTimeout(() => setStatus("", null), 2500);
  }

  function showNotice(text) {
    noticeEl.textContent = text;
    noticeEl.hidden = !text;
  }

  function activeTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) =>
        resolve(tabs[0] || null),
      );
    });
  }

  // content script に番組名などを聞く。注入されていなければ URL 由来の情報で代替する
  function askPageInfo(tabId) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: "LTD_PAGE_INFO" }, (response) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(response);
      });
    });
  }

  async function init() {
    const settings = await ListenSettings.load();
    enabledInput.checked = settings.enabled;
    displayNameInput.value = settings.displayName;

    const tab = await activeTab();
    const parsed = tab ? ListenUrl.parseListenUrl(tab.url || "") : null;

    if (!parsed) {
      showNotice("LISTEN の番組ページを開くと、その番組をここで登録できます。");
      return;
    }

    const info = (await askPageInfo(tab.id)) || parsed;
    currentSlug = info.programSlug;

    programSection.hidden = false;
    programLabelEl.textContent = info.programLabel || info.programSlug;
    programSlugEl.textContent = info.programSlug;

    const program = settings.programs[currentSlug];
    if (program) {
      webhookUrlInput.value = program.webhookUrl || "";
      saveButton.textContent = "更新する";
      removeButton.hidden = false;
      showNotice("この番組は登録済みです。");
    } else {
      showNotice("");
    }
  }

  saveButton.addEventListener("click", async () => {
    const webhookUrl = webhookUrlInput.value.trim();
    if (!ListenSettings.isValidWebhookUrl(webhookUrl)) {
      setStatus("Discord の Webhook URL を入力してください", "error");
      return;
    }

    await ListenSettings.save({
      displayName: displayNameInput.value.trim(),
      enabled: enabledInput.checked,
    });
    await ListenSettings.upsertProgram(currentSlug, {
      label: programLabelEl.textContent,
      webhookUrl,
    });

    saveButton.textContent = "更新する";
    removeButton.hidden = false;
    showNotice("この番組は登録済みです。");
    setStatus("保存しました", "ok");
  });

  removeButton.addEventListener("click", async () => {
    await ListenSettings.removeProgram(currentSlug);
    webhookUrlInput.value = "";
    saveButton.textContent = "この番組を登録";
    removeButton.hidden = true;
    showNotice("");
    setStatus("登録を解除しました", "ok");
  });

  // 表示名と ON/OFF は番組を登録していなくても変えられるようにしておく
  for (const input of [enabledInput, displayNameInput]) {
    input.addEventListener("change", async () => {
      await ListenSettings.save({
        displayName: displayNameInput.value.trim(),
        enabled: enabledInput.checked,
      });
      setStatus("保存しました", "ok");
    });
  }

  document.getElementById("openOptions").addEventListener("click", (event) => {
    event.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  init();
})();
