// 登録済みの番組をまとめて管理する画面。
(function () {
  const enabledInput = document.getElementById("enabled");
  const displayNameInput = document.getElementById("displayName");
  const programsBody = document.getElementById("programs");
  const emptyEl = document.getElementById("empty");
  const statusEl = document.getElementById("status");

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = `status${kind ? ` ${kind}` : ""}`;
    if (text) setTimeout(() => setStatus("", null), 2500);
  }

  function cell(row, content) {
    const td = document.createElement("td");
    if (typeof content === "string") td.textContent = content;
    else td.appendChild(content);
    row.appendChild(td);
    return td;
  }

  function textInput(value, onCommit) {
    const input = document.createElement("input");
    input.type = "text";
    input.value = value || "";
    input.addEventListener("change", () => onCommit(input.value.trim()));
    return input;
  }

  function button(label, onClick, className) {
    const el = document.createElement("button");
    el.textContent = label;
    if (className) el.className = className;
    el.addEventListener("click", onClick);
    return el;
  }

  function sendTest(slug) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "LTD_TEST", programSlug: slug }, resolve);
    });
  }

  function renderRow(slug, program) {
    const row = document.createElement("tr");

    cell(
      row,
      textInput(program.label, async (label) => {
        await ListenSettings.upsertProgram(slug, { label });
        setStatus("保存しました", "ok");
      }),
    );

    const slugCell = cell(row, slug);
    slugCell.className = "slug";

    cell(
      row,
      textInput(program.webhookUrl, async (webhookUrl) => {
        if (!ListenSettings.isValidWebhookUrl(webhookUrl)) {
          setStatus("Discord の Webhook URL を入力してください", "error");
          return;
        }
        await ListenSettings.upsertProgram(slug, { webhookUrl });
        setStatus("保存しました", "ok");
      }),
    );

    const actions = cell(row, "");
    actions.className = "actions";
    actions.appendChild(
      button("テスト送信", async (event) => {
        const target = event.target;
        target.disabled = true;
        const result = await sendTest(slug);
        target.disabled = false;
        if (result && result.ok) setStatus("テスト送信しました", "ok");
        else setStatus(`送信に失敗しました: ${(result && result.error) || "不明"}`, "error");
      }),
    );
    actions.appendChild(
      button("削除", async () => {
        await ListenSettings.removeProgram(slug);
        await render();
        setStatus("削除しました", "ok");
      }),
    );

    return row;
  }

  async function render() {
    const settings = await ListenSettings.load();
    enabledInput.checked = settings.enabled;
    displayNameInput.value = settings.displayName;

    programsBody.textContent = "";
    const slugs = Object.keys(settings.programs).sort();
    for (const slug of slugs) {
      programsBody.appendChild(renderRow(slug, settings.programs[slug]));
    }
    emptyEl.hidden = slugs.length > 0;
  }

  for (const input of [enabledInput, displayNameInput]) {
    input.addEventListener("change", async () => {
      await ListenSettings.save({
        displayName: displayNameInput.value.trim(),
        enabled: enabledInput.checked,
      });
      setStatus("保存しました", "ok");
    });
  }

  document.getElementById("add").addEventListener("click", async () => {
    const slugInput = document.getElementById("newSlug");
    const labelInput = document.getElementById("newLabel");
    const webhookInput = document.getElementById("newWebhookUrl");

    const slug = slugInput.value.trim();
    const webhookUrl = webhookInput.value.trim();

    if (!slug) {
      setStatus("番組スラッグを入力してください", "error");
      return;
    }
    if (!ListenSettings.isValidWebhookUrl(webhookUrl)) {
      setStatus("Discord の Webhook URL を入力してください", "error");
      return;
    }

    await ListenSettings.upsertProgram(slug, {
      label: labelInput.value.trim() || slug,
      webhookUrl,
    });

    slugInput.value = "";
    labelInput.value = "";
    webhookInput.value = "";
    await render();
    setStatus("追加しました", "ok");
  });

  render();
})();
