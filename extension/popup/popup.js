const toggle = document.getElementById("enabled");
const autoTranslateToggle = document.getElementById("auto-translate");
const status = document.getElementById("status");

for (const placeholder of document.querySelectorAll("[data-phosphor-icon]")) {
  const name = placeholder.dataset.phosphorIcon;
  const paths = globalThis.TuzaiPhosphorIcons?.[name];
  if (!paths) continue;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 256 256");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("tuzai-icon");
  svg.innerHTML = paths;
  placeholder.replaceWith(svg);
}

function render(enabled, autoTranslate) {
  toggle.checked = enabled;
  autoTranslateToggle.checked = autoTranslate;
  status.textContent = enabled
    ? `浮层已开启${autoTranslate ? " · 外语帖子自动显示中文" : ""}`
    : "浮层已关闭";
}

async function readSettings() {
  const settings = await chrome.storage.sync.get({ enabled: true, autoTranslate: true });
  render(Boolean(settings.enabled), Boolean(settings.autoTranslate));
}

readSettings();

toggle.addEventListener("change", async () => {
  const enabled = toggle.checked;
  await chrome.storage.sync.set({ enabled });
  await readSettings();
});

autoTranslateToggle.addEventListener("change", async () => {
  await chrome.storage.sync.set({ autoTranslate: autoTranslateToggle.checked });
  await readSettings();
});
