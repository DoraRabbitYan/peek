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

  await chrome.tabs.sendMessage(job.openerTabId, {
    type: message.type,
    requestId: job.requestId,
    source: message.source ?? null,
    replies: message.replies ?? [],
    error: message.error ?? null
  });

  job.extractedAt = Date.now();
  await storeJob(loaderTabId, job);
}

async function allJobs() {
  const stored = await chrome.storage.session.get(null);
  const restored = Object.entries(stored)
    .filter(([key, value]) => key.startsWith(JOB_PREFIX) && value?.loaderTabId)
    .map(([, value]) => value);
  for (const job of restored) loaderJobs.set(job.loaderTabId, job);
  return restored;
}

async function findOpenerJob(openerTabId, requestId) {
  const jobs = await allJobs();
  return jobs.find((job) => job.openerTabId === openerTabId && job.requestId === requestId) ?? null;
}

async function performAction(message, sender) {
  const openerTabId = sender.tab?.id;
  if (!openerTabId || !message.requestId || !message.url || !message.action) {
    throw new Error("交互请求不完整");
  }

  const job = await findOpenerJob(openerTabId, message.requestId);
  if (!job) throw new Error("帖子交互会话已经结束，请重新打开浮层");

  return chrome.tabs.sendMessage(job.loaderTabId, {
    type: "TUZAI_PERFORM_ACTION",
    requestId: job.requestId,
    url: message.url,
    action: message.action,
    text: message.text ?? ""
  });
}

async function cancelRequest(message, sender) {
  const openerTabId = sender.tab?.id;
  if (!openerTabId) return;

  const jobs = await allJobs();
  for (const job of jobs) {
    if (job.openerTabId === openerTabId && job.requestId === message.requestId) {
      await clearJob(job.loaderTabId);
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
      case "TUZAI_ACTION":
        return performAction(message, sender);
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
  const jobs = await allJobs();
  for (const job of jobs) {
    if (job.loaderTabId === tabId) await clearJob(tabId, false);
    else if (job.openerTabId === tabId) await clearJob(job.loaderTabId);
  }
});
