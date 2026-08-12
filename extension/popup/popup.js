const toggle = document.getElementById("enabled");
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

function render(enabled) {
  toggle.checked = enabled;
  status.textContent = enabled ? "已开启：点击帖子正文即可使用" : "已关闭";
}

chrome.storage.sync.get({ enabled: true }).then(({ enabled }) => render(enabled));

toggle.addEventListener("change", async () => {
  const enabled = toggle.checked;
  await chrome.storage.sync.set({ enabled });
  render(enabled);
});
