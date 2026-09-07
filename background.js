"use strict";

if (typeof importScripts === "function") importScripts("safety.js");

const STORAGE_NOTES = "notesById";
const STORAGE_HISTORY = "noteHistory";
const STORAGE_TASK = "collectorTask";
const STORAGE_ARCHIVE_JOBS = "archiveJobs";
const STORAGE_PUBLISH_DRAFT = "activePublishDraft";
const STORAGE_COMMENT_USAGE = "commentAssistUsage";
const STORAGE_COMMENT_JOBS = "commentAssistJobs";
const ALARM_CAPTURE = "xhsCollectorCapture";
const ALARM_NEXT = "xhsCollectorNext";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function defaultTask() {
  return {
    status: "idle",
    mode: "keyword",
    phase: "search",
    keyword: "",
    scrollRounds: 2,
    detailLimit: 5,
    queue: [],
    archiveNoteIds: [],
    index: 0,
    foundCount: 0,
    successCount: 0,
    downloadedFileCount: 0,
    failureCount: 0,
    failures: [],
    delaySeconds: 12,
    autoDownload: true,
    taskTabId: null,
    awaitingLoad: false,
    message: "尚未开始"
  };
}

function noteIdFromUrl(value) {
  const match = String(value || "").match(/\/(?:explore|search_result|discovery\/item)\/([a-f0-9]{16,32})(?:[/?#]|$)/i);
  return match ? match[1].toLowerCase() : "";
}

function normalizeNoteUrl(value) {
  try {
    const url = new URL(clean(value));
    if (url.protocol !== "https:") return null;
    if (!(url.hostname === "xiaohongshu.com" || url.hostname.endsWith(".xiaohongshu.com"))) return null;
    const noteId = noteIdFromUrl(url.href);
    return noteId ? { noteId, url: url.href } : null;
  } catch {
    return null;
  }
}

function normalizeUrlQueue(rawItems) {
  const values = Array.isArray(rawItems)
    ? rawItems
    : String(rawItems || "").split(/[\n\s]+/);
  const seen = new Set();
  const queue = [];
  for (const value of values) {
    const item = typeof value === "object" && value?.url
      ? normalizeNoteUrl(value.url)
      : normalizeNoteUrl(value);
    if (!item || seen.has(item.noteId)) continue;
    seen.add(item.noteId);
    queue.push(item);
  }
  return queue;
}

function localDayKey(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

async function getCommentLimits() {
  const data = await chrome.storage.local.get(STORAGE_COMMENT_USAGE);
  const usage = Array.isArray(data[STORAGE_COMMENT_USAGE]) ? data[STORAGE_COMMENT_USAGE] : [];
  const day = localDayKey();
  const today = usage.filter((item) => item.day === day);
  const latestAt = usage.reduce((latest, item) => Math.max(latest, Number(item.at) || 0), 0);
  return { todayCount: today.length, remaining: Math.max(0, 10 - today.length), latestAt };
}

async function recordCommentPreparation(comment, url) {
  const data = await chrome.storage.local.get(STORAGE_COMMENT_USAGE);
  const usage = Array.isArray(data[STORAGE_COMMENT_USAGE]) ? data[STORAGE_COMMENT_USAGE] : [];
  usage.push({ comment, url, at: Date.now(), day: localDayKey() });
  await chrome.storage.local.set({ [STORAGE_COMMENT_USAGE]: usage.slice(-100) });
}

async function openStudio() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const params = new URLSearchParams();
  if (activeTab?.id && normalizeNoteUrl(activeTab.url || "")) {
    params.set("sourceTabId", String(activeTab.id));
    params.set("sourceUrl", activeTab.url);
  }
  const query = params.toString();
  await chrome.tabs.create({ url: chrome.runtime.getURL(`studio.html${query ? `?${query}` : ""}`) });
  return { ok: true };
}

async function preparePublish(message) {
  const draft = {
    title: clean(message.draft?.title),
    body: String(message.draft?.body || "").trim(),
    tags: clean(message.draft?.tags),
    commercial: Boolean(message.draft?.commercial),
    updatedAt: new Date().toISOString()
  };
  if (!draft.title || !draft.body) throw new Error("标题和正文不能为空。");
  const review = globalThis.XhsSafety?.reviewText(`${draft.title}\n${draft.body}\n${draft.tags}`, { mode: "draft" });
  if (review?.blockers?.length) throw new Error(`草稿存在阻断项：${review.blockers.map((item) => item.label).join("、")}`);
  if (review?.warnings?.length && !message.acknowledged) throw new Error("请先查看并确认合规风险提示。");
  await chrome.storage.local.set({ [STORAGE_PUBLISH_DRAFT]: draft });
  const tab = await chrome.tabs.create({
    url: "https://creator.xiaohongshu.com/publish/publish?source=official",
    active: true
  });
  return { tabId: tab.id, review, message: "已打开官方发布页；扩展不会点击最终发布按钮。" };
}

async function saveCommentJob(tabId, comment) {
  const data = await chrome.storage.local.get(STORAGE_COMMENT_JOBS);
  const jobs = data[STORAGE_COMMENT_JOBS] || {};
  jobs[String(tabId)] = { comment, createdAt: Date.now() };
  await chrome.storage.local.set({ [STORAGE_COMMENT_JOBS]: jobs });
}

async function removeCommentJob(tabId) {
  const data = await chrome.storage.local.get(STORAGE_COMMENT_JOBS);
  const jobs = data[STORAGE_COMMENT_JOBS] || {};
  if (!Object.prototype.hasOwnProperty.call(jobs, String(tabId))) return;
  delete jobs[String(tabId)];
  await chrome.storage.local.set({ [STORAGE_COMMENT_JOBS]: jobs });
}

async function prepareComment(message) {
  const comment = String(message.comment || "").trim();
  const review = globalThis.XhsSafety?.reviewText(comment, { mode: "comment" });
  if (!review || !review.ok) {
    const labels = review?.blockers?.map((item) => item.label).join("、") || "评论未通过检查";
    throw new Error(`请先修改评论：${labels}`);
  }
  const data = await chrome.storage.local.get(STORAGE_COMMENT_USAGE);
  const usage = Array.isArray(data[STORAGE_COMMENT_USAGE]) ? data[STORAGE_COMMENT_USAGE] : [];
  const now = Date.now();
  const limits = await getCommentLimits();
  if (limits.todayCount >= 10) throw new Error("今天已准备 10 条评论，请明天再继续。");
  if (limits.latestAt && now - limits.latestAt < 5 * 60 * 1000) throw new Error("相邻两次评论至少间隔 5 分钟。");
  const duplicate = usage.find((item) => now - (Number(item.at) || 0) < 30 * 24 * 60 * 60 * 1000
    && globalThis.XhsSafety.similarity(item.comment, comment) >= 0.82);
  if (duplicate) throw new Error("这段话与近期评论过于相似，请结合当前笔记改写具体细节。");

  let tab = null;
  if (Number.isInteger(Number(message.sourceTabId)) && Number(message.sourceTabId) > 0) {
    try {
      const candidate = await chrome.tabs.get(Number(message.sourceTabId));
      if (normalizeNoteUrl(candidate.url || "")) tab = candidate;
    } catch { /* 原笔记标签页可能已关闭 */ }
  }
  if (!tab) {
    const target = normalizeNoteUrl(message.targetUrl);
    if (!target) throw new Error("请粘贴完整的小红书笔记链接。");
    tab = await chrome.tabs.create({ url: target.url, active: true });
    await saveCommentJob(tab.id, comment);
    await recordCommentPreparation(comment, target.url);
    return { tabId: tab.id, queued: true, message: "笔记打开后会填入评论框；最终发送请你人工确认。" };
  }
  const response = await chrome.tabs.sendMessage(tab.id, { type: "XHS_FILL_COMMENT", comment });
  if (!response?.ok) throw new Error(response?.error || "没有找到评论输入框，请展开评论区后重试。");
  await chrome.tabs.update(tab.id, { active: true });
  await recordCommentPreparation(comment, tab.url || message.targetUrl || "");
  return { tabId: tab.id, queued: false, message: "评论已填入；最终发送请你人工确认。" };
}

function isXiaohongshuUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && (url.hostname === "xiaohongshu.com" || url.hostname.endsWith(".xiaohongshu.com"));
  } catch {
    return false;
  }
}

async function getTask() {
  const data = await chrome.storage.local.get(STORAGE_TASK);
  return { ...defaultTask(), ...(data[STORAGE_TASK] || {}) };
}

async function setTask(task) {
  await chrome.storage.local.set({ [STORAGE_TASK]: task });
  return task;
}

async function saveNotes(notes) {
  const now = new Date().toISOString();
  const data = await chrome.storage.local.get([STORAGE_NOTES, STORAGE_HISTORY]);
  const notesById = data[STORAGE_NOTES] || {};
  const history = Array.isArray(data[STORAGE_HISTORY]) ? data[STORAGE_HISTORY] : [];
  let saved = 0;

  for (const rawNote of notes || []) {
    const noteId = clean(rawNote.noteId).toLowerCase();
    if (!/^[a-f0-9]{16,32}$/.test(noteId)) continue;
    const previous = notesById[noteId] || {};
    const sourceKeywords = [...new Set([
      ...(Array.isArray(previous.sourceKeywords) ? previous.sourceKeywords : []),
      ...(Array.isArray(rawNote.sourceKeywords) ? rawNote.sourceKeywords : []),
      clean(rawNote.sourceKeyword)
    ].filter(Boolean))];
    const note = { ...previous };
    for (const [field, value] of Object.entries(rawNote)) {
      const isEmpty = value === "" || value === null || value === undefined
        || (Array.isArray(value) && value.length === 0);
      const previousHasValue = previous[field] !== "" && previous[field] !== null
        && previous[field] !== undefined
        && (!Array.isArray(previous[field]) || previous[field].length > 0);
      if (isEmpty && previousHasValue) continue;
      note[field] = value;
    }
    Object.assign(note, {
      noteId,
      sourceKeywords,
      firstSeen: previous.firstSeen || rawNote.capturedAt || now,
      lastSeen: rawNote.capturedAt || now
    });
    notesById[noteId] = note;
    history.push({ ...rawNote, noteId, capturedAt: rawNote.capturedAt || now });
    saved += 1;
  }

  await chrome.storage.local.set({
    [STORAGE_NOTES]: notesById,
    [STORAGE_HISTORY]: history.slice(-50000)
  });
  return saved;
}

function safeFolderSegment(value, fallback = "未命名") {
  const normalized = clean(value)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[.\s]+$/g, "")
    .slice(0, 72);
  return normalized || fallback;
}

async function startArchiveJob(noteIds, archiveName = "") {
  const ids = [...new Set((noteIds || []).map((value) => clean(value).toLowerCase()))]
    .filter((value) => /^[a-f0-9]{16,32}$/.test(value))
    .slice(0, 200);
  if (!ids.length) throw new Error("没有可归档的笔记。");
  const jobId = crypto.randomUUID();
  const data = await chrome.storage.local.get(STORAGE_ARCHIVE_JOBS);
  const jobs = data[STORAGE_ARCHIVE_JOBS] || {};
  jobs[jobId] = {
    jobId,
    noteIds: ids,
    archiveName: safeFolderSegment(archiveName || "小红书归档"),
    createdAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ [STORAGE_ARCHIVE_JOBS]: jobs });
  await chrome.tabs.create({
    url: chrome.runtime.getURL(`archive.html?job=${encodeURIComponent(jobId)}`),
    active: false
  });
  return { jobId, noteCount: ids.length, archiveName: jobs[jobId].archiveName };
}

async function getArchiveJob(jobId) {
  const data = await chrome.storage.local.get([STORAGE_ARCHIVE_JOBS, STORAGE_NOTES]);
  const job = data[STORAGE_ARCHIVE_JOBS]?.[jobId];
  if (!job) throw new Error("归档任务不存在或已经完成。");
  const notesById = data[STORAGE_NOTES] || {};
  return { job, notes: job.noteIds.map((noteId) => notesById[noteId]).filter(Boolean) };
}

async function finishArchiveJob(jobId) {
  const data = await chrome.storage.local.get(STORAGE_ARCHIVE_JOBS);
  const jobs = data[STORAGE_ARCHIVE_JOBS] || {};
  delete jobs[jobId];
  await chrome.storage.local.set({ [STORAGE_ARCHIVE_JOBS]: jobs });
  return { ok: true };
}

async function sendExtract(tabId, scrollRounds = 0) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "XHS_EXTRACT", scrollRounds });
  } catch (error) {
    return { ok: false, error: `页面采集脚本未就绪：${error.message || error}`, notes: [] };
  }
}

async function captureActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isXiaohongshuUrl(tab.url || "")) {
    throw new Error("请先打开小红书搜索页或笔记详情页。");
  }
  const result = await sendExtract(tab.id, 0);
  if (!result?.ok) throw new Error(result?.error || "页面采集失败。");
  if (result.blocked) return { ...result, saved: 0 };
  const saved = await saveNotes(result.notes);
  return { ...result, saved };
}

async function captureAndDownloadActiveTab() {
  const result = await captureActiveTab();
  if (result.blocked) return { ...result, download: null };
  const noteIds = (result.notes || []).map((note) => note.noteId).filter(Boolean);
  return {
    ...result,
    download: await startArchiveJob(noteIds, "小红书归档")
  };
}

async function scheduleNext(seconds) {
  await chrome.alarms.clear(ALARM_NEXT);
  chrome.alarms.create(ALARM_NEXT, { when: Date.now() + Math.max(1, seconds) * 1000 });
}

async function completeTask(task) {
  const completedTabId = task.taskTabId;
  task.status = "completed";
  task.awaitingLoad = false;
  task.taskTabId = null;
  let archiveStarted = false;
  if (task.autoDownload && task.archiveNoteIds?.length) {
    await startArchiveJob(task.archiveNoteIds, task.keyword || "小红书批量归档");
    archiveStarted = true;
  }
  task.message = task.mode === "keyword"
    ? `采集完成：找到 ${task.foundCount} 篇，补采 ${task.successCount} 篇，失败 ${task.failureCount}${archiveStarted ? "；正在生成一个 ZIP" : ""}`
    : `采集完成：成功 ${task.successCount} 篇，失败 ${task.failureCount}${archiveStarted ? "；正在生成一个 ZIP" : ""}`;
  await setTask(task);
  if (completedTabId) {
    try { await chrome.tabs.remove(completedTabId); } catch { /* 标签页可能已关闭 */ }
  }
  return task;
}

async function navigateTask() {
  const task = await getTask();
  if (task.status !== "running") return;

  let url = "";
  if (task.phase === "search") {
    const params = new URLSearchParams({
      keyword: task.keyword,
      source: "web_search_result_notes"
    });
    url = `https://www.xiaohongshu.com/search_result?${params.toString()}`;
    task.message = `正在搜索“${task.keyword}”并滚动加载笔记`;
  } else {
    if (task.index >= task.queue.length) return completeTask(task);
    url = task.queue[task.index].url;
    task.message = `正在补采详情 ${task.index + 1}/${task.queue.length}`;
  }

  task.awaitingLoad = true;
  try {
    if (task.taskTabId) {
      await chrome.tabs.update(task.taskTabId, { url, active: true });
    } else {
      const tab = await chrome.tabs.create({ url, active: true });
      task.taskTabId = tab.id;
    }
    await setTask(task);
  } catch (error) {
    task.failureCount += 1;
    task.failures.push({ url, reason: error.message || String(error) });
    task.awaitingLoad = false;
    if (task.phase === "search") return completeTask(task);
    task.index += 1;
    await setTask(task);
    await scheduleNext(task.delaySeconds);
  }
}

async function collectTaskTab() {
  const task = await getTask();
  if (task.status !== "running" || !task.taskTabId) return;
  const result = await sendExtract(task.taskTabId, task.phase === "search" ? task.scrollRounds : 0);

  if (result?.blocked) {
    task.status = "paused";
    task.message = result.reason || "需要人工处理当前页面后继续。";
    await setTask(task);
    return;
  }

  if (task.phase === "search") {
    if (!result?.ok || !result.notes?.length) {
      task.failureCount += 1;
      task.failures.push({ keyword: task.keyword, reason: result?.error || "搜索页中没有识别到笔记" });
      return completeTask(task);
    }
    const annotated = result.notes.map((note, index) => ({
      ...note,
      sourceKeyword: task.keyword,
      sourceKeywords: [task.keyword],
      searchRank: index + 1
    }));
    await saveNotes(annotated);
    task.foundCount = annotated.length;
    task.queue = normalizeUrlQueue(annotated).slice(0, task.detailLimit);
    task.archiveNoteIds = (task.queue.length ? task.queue : normalizeUrlQueue(annotated))
      .map((item) => item.noteId);
    task.phase = "detail";
    task.index = 0;
    task.awaitingLoad = false;
    if (!task.queue.length) return completeTask(task);
    task.message = `找到 ${task.foundCount} 篇笔记，开始补采前 ${task.queue.length} 篇详情`;
    await setTask(task);
    await scheduleNext(task.delaySeconds);
    return;
  }

  const current = task.queue[task.index];
  if (result?.ok && result.notes?.length) {
    const annotated = result.notes.map((note) => ({
      ...note,
      sourceKeywords: task.keyword ? [task.keyword] : []
    }));
    const saved = await saveNotes(annotated);
    if (saved) {
      task.successCount += 1;
    }
    else {
      task.failureCount += 1;
      task.failures.push({ url: current?.url, reason: "没有识别到有效笔记数据" });
    }
  } else {
    task.failureCount += 1;
    task.failures.push({ url: current?.url, reason: result?.error || "笔记详情解析失败" });
  }
  task.index += 1;
  task.awaitingLoad = false;
  task.message = `已处理详情 ${task.index}/${task.queue.length}`;
  await setTask(task);
  await scheduleNext(task.delaySeconds);
}

async function startKeywordTask(message) {
  const keyword = clean(message.keyword);
  if (!keyword) throw new Error("请输入要搜索的笔记关键词，例如：淋浴房。");
  const task = {
    ...defaultTask(),
    status: "running",
    mode: "keyword",
    phase: "search",
    keyword,
    scrollRounds: Math.min(10, Math.max(1, Number(message.scrollRounds) || 2)),
    detailLimit: Math.min(50, Math.max(0, Number(message.detailLimit) || 0)),
    delaySeconds: Math.min(60, Math.max(5, Number(message.delaySeconds) || 12)),
    autoDownload: message.autoDownload !== false,
    message: `准备搜索“${keyword}”`
  };
  await setTask(task);
  await navigateTask();
  return task;
}

async function startUrlTask(message) {
  const queue = normalizeUrlQueue(message.items);
  if (!queue.length) throw new Error("没有识别到有效的小红书笔记链接；请保留完整链接和 xsec_token。");
  const task = {
    ...defaultTask(),
    status: "running",
    mode: "urls",
    phase: "detail",
    queue,
    archiveNoteIds: queue.map((item) => item.noteId),
    delaySeconds: Math.min(60, Math.max(5, Number(message.delaySeconds) || 12)),
    autoDownload: message.autoDownload !== false,
    message: `准备采集 ${queue.length} 篇笔记`
  };
  await setTask(task);
  await navigateTask();
  return task;
}

async function pauseTask() {
  const task = await getTask();
  if (task.status === "running") {
    task.status = "paused";
    task.message = "已暂停";
    await chrome.alarms.clear(ALARM_CAPTURE);
    await chrome.alarms.clear(ALARM_NEXT);
    await setTask(task);
  }
  return task;
}

async function resumeTask() {
  const task = await getTask();
  if (!["paused", "error"].includes(task.status)) return task;
  task.status = "running";
  task.awaitingLoad = false;
  task.message = "正在继续";
  await setTask(task);
  await navigateTask();
  return task;
}

async function stopTask() {
  const task = await getTask();
  task.status = "stopped";
  task.awaitingLoad = false;
  task.message = task.phase === "search"
    ? "已停止搜索"
    : `已停止，详情进度 ${task.index}/${task.queue.length}`;
  await chrome.alarms.clear(ALARM_CAPTURE);
  await chrome.alarms.clear(ALARM_NEXT);
  await setTask(task);
  return task;
}

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(STORAGE_TASK);
  if (!data[STORAGE_TASK]) await setTask(defaultTask());
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  const assistData = await chrome.storage.local.get(STORAGE_COMMENT_JOBS);
  const commentJob = assistData[STORAGE_COMMENT_JOBS]?.[String(tabId)];
  if (commentJob) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: "XHS_FILL_COMMENT", comment: commentJob.comment });
    } catch {
      /* 页面结构变化时由用户在助手中重试 */
    } finally {
      await removeCommentJob(tabId);
    }
  }
  const task = await getTask();
  if (task.status !== "running" || task.taskTabId !== tabId || !task.awaitingLoad) return;
  task.awaitingLoad = false;
  task.message = task.phase === "search" ? "页面已加载，正在滚动并读取笔记" : "页面已加载，正在读取详情";
  await setTask(task);
  await chrome.alarms.clear(ALARM_CAPTURE);
  chrome.alarms.create(ALARM_CAPTURE, { when: Date.now() + 2200 });
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await removeCommentJob(tabId);
  const task = await getTask();
  if (task.taskTabId !== tabId || !["running", "paused"].includes(task.status)) return;
  task.taskTabId = null;
  task.status = "paused";
  task.awaitingLoad = false;
  task.message = "自动采集标签页已关闭，任务已暂停。";
  await setTask(task);
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_CAPTURE) await collectTaskTab();
  if (alarm.name === ALARM_NEXT) await navigateTask();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "CAPTURE_ACTIVE": return captureActiveTab();
      case "CAPTURE_AND_DOWNLOAD_ACTIVE": return captureAndDownloadActiveTab();
      case "START_KEYWORD": return startKeywordTask(message);
      case "START_URLS": return startUrlTask(message);
      case "PAUSE_TASK": return pauseTask();
      case "RESUME_TASK": return resumeTask();
      case "STOP_TASK": return stopTask();
      case "GET_TASK": return getTask();
      case "GET_NOTES": {
        const data = await chrome.storage.local.get([STORAGE_NOTES, STORAGE_HISTORY]);
        return {
          notes: Object.values(data[STORAGE_NOTES] || {}),
          history: Array.isArray(data[STORAGE_HISTORY]) ? data[STORAGE_HISTORY] : []
        };
      }
      case "DOWNLOAD_NOTES": return startArchiveJob(message.noteIds, message.archiveName || "小红书归档");
      case "GET_ARCHIVE_JOB": return getArchiveJob(message.jobId);
      case "FINISH_ARCHIVE_JOB": return finishArchiveJob(message.jobId);
      case "PREPARE_PUBLISH": return preparePublish(message);
      case "GET_ACTIVE_PUBLISH_DRAFT": {
        const data = await chrome.storage.local.get(STORAGE_PUBLISH_DRAFT);
        return data[STORAGE_PUBLISH_DRAFT] || null;
      }
      case "PREPARE_COMMENT": return prepareComment(message);
      case "GET_COMMENT_LIMITS": return getCommentLimits();
      case "CLEAR_NOTES":
        await chrome.storage.local.remove([STORAGE_NOTES, STORAGE_HISTORY]);
        return { ok: true };
      case "OPEN_DASHBOARD":
        await chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
        return { ok: true };
      case "OPEN_STUDIO": return openStudio();
      default:
        throw new Error("未知操作。");
    }
  })()
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});
