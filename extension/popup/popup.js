const toggle = document.getElementById("enabled");
const status = document.getElementById("status");

function render(enabled) {
  toggle.checked = enabled;
  status.textContent = enabled ? "已开启：点击帖子正文即可使用" : "已关闭";
}

chrome.storage.sync.get({ enabled: true }).then(({ enabled }) => render(enabled));

toggle.addEventListener("change", async () => {
  const enabled = toggle.checked;
  await chrome.storage.sync.set({ enabled });
  render(enabled);
  const tabs = await chrome.tabs.query({ url: ["https://x.com/*", "https://twitter.com/*"] });
  await Promise.allSettled(tabs.map((tab) => chrome.tabs.sendMessage(tab.id, { type: "TUZAI_SET_ENABLED", enabled })));
});
