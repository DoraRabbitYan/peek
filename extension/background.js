"use strict";

const loaderJobs = new Map();
const JOB_PREFIX = "tuzai-loader:";

function jobKey(tabId) {
  return `${JOB_PREFIX}${tabId}`;
}

async function storeJob(tabId, job) {
  loaderJobs.set(tabId, job);
  await chrome.storage.session.set({ [jobKey(tabId)]: job });
}

async function readJob(tabId) {
  if (loaderJobs.has(tabId)) return loaderJobs.get(tabId);
  const stored = await chrome.storage.session.get(jobKey(tabId));
  const job = stored[jobKey(tabId)] ?? null;
  if (job) loaderJobs.set(tabId, job);
  return job;
}

async function clearJob(tabId, closeTab = true) {
  loaderJobs.delete(tabId);
  await chrome.storage.session.remove(jobKey(tabId));
  if (closeTab) {
    try { await chrome.tabs.remove(tabId); } catch { /* tab already closed */ }
  }
}

async function openPost(message, sender) {
  const openerTabId = sender.tab?.id;
  if (!openerTabId || !message.url || !message.requestId) return;

  const loaderTab = await chrome.tabs.create({ url: message.url, active: false });
  if (!loaderTab.id) throw new Error("无法创建评论读取标签页");

  await storeJob(loaderTab.id, {
    loaderTabId: loaderTab.id,
    openerTabId,
    requestId: message.requestId,
    url: message.url,
    createdAt: Date.now()
  });
}

async function beginExtraction(sender) {
  const loaderTabId = sender.tab?.id;
  if (!loaderTabId) return;
  const job = await readJob(loaderTabId);
  if (!job) return;

  await chrome.tabs.sendMessage(loaderTabId, {
    type: "TUZAI_BEGIN_EXTRACTION",
    requestId: job.requestId,
    url: job.url
  });
}

async function forwardResult(message, sender) {
  const loaderTabId = sender.tab?.id;
  if (!loaderTabId) return;
  const job = await readJob(loaderTabId);
  if (!job || job.requestId !== message.requestId) return;

  try {
    await chrome.tabs.sendMessage(job.openerTabId, {
      type: message.type,
      requestId: job.requestId,
      replies: message.replies ?? [],
      error: message.error ?? null
    });
  } finally {
    await clearJob(loaderTabId);
  }
}

async function cancelRequest(message, sender) {
  const openerTabId = sender.tab?.id;
  if (!openerTabId) return;

  const jobs = [...loaderJobs.entries()];
  for (const [loaderTabId, job] of jobs) {
    if (job.openerTabId === openerTabId && job.requestId === message.requestId) {
      await clearJob(loaderTabId);
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const run = async () => {
    switch (message?.type) {
      case "TUZAI_OPEN_POST":
        await openPost(message, sender);
        return { ok: true };
      case "TUZAI_CONTENT_READY":
        await beginExtraction(sender);
        return { ok: true };
      case "TUZAI_EXTRACTION_RESULT":
      case "TUZAI_EXTRACTION_ERROR":
        await forwardResult(message, sender);
        return { ok: true };
      case "TUZAI_CANCEL":
        await cancelRequest(message, sender);
        return { ok: true };
      default:
        return { ok: false };
    }
  };

  run().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (loaderJobs.has(tabId)) await clearJob(tabId, false);
});
