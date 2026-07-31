// chrome.storage への読み書きをまとめたラッパ。
// 同期を切りたくなったら STORAGE_AREA を "local" にするだけでよい。
(function (root, factory) {
  const api = factory();
  root.ListenSettings = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const STORAGE_AREA = "sync";

  const DEFAULTS = {
    displayName: "",
    enabled: true,
    programs: {},
  };

  function area() {
    return chrome.storage[STORAGE_AREA];
  }

  function load() {
    return new Promise((resolve) => {
      area().get(DEFAULTS, (items) => resolve(Object.assign({}, DEFAULTS, items)));
    });
  }

  function save(patch) {
    return new Promise((resolve) => area().set(patch, resolve));
  }

  async function upsertProgram(slug, program) {
    const settings = await load();
    const programs = Object.assign({}, settings.programs);
    programs[slug] = Object.assign({}, programs[slug], program);
    await save({ programs });
    return programs;
  }

  async function removeProgram(slug) {
    const settings = await load();
    const programs = Object.assign({}, settings.programs);
    delete programs[slug];
    await save({ programs });
    return programs;
  }

  function isValidWebhookUrl(url) {
    return typeof url === "string" && /^https:\/\/discord\.com\/api\/webhooks\//.test(url);
  }

  return {
    STORAGE_AREA,
    DEFAULTS,
    load,
    save,
    upsertProgram,
    removeProgram,
    isValidWebhookUrl,
  };
});
