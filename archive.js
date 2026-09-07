"use strict";

const statusElement = document.querySelector("#archiveStatus");
const progressElement = document.querySelector("#archiveProgress");
const encoder = new TextEncoder();

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "操作失败");
  return response.result;
}

function safeSegment(value, fallback = "未命名") {
  const normalized = String(value || "").replace(/\s+/g, " ").trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[.\s]+$/g, "")
    .slice(0, 72);
  return normalized || fallback;
}

function markdownForNote(note) {
  return [
    `# ${note.title || "无标题笔记"}`, "",
    `- 作者：${note.author || "未知"}`,
    `- 发布时间：${note.publishedAt || "未知"}`,
    `- IP 属地：${note.ipLocation || "未知"}`,
    `- 点赞：${note.likes ?? note.likesText ?? "未知"}`,
    `- 收藏：${note.collects ?? note.collectsText ?? "未知"}`,
    `- 评论：${note.comments ?? note.commentsText ?? "未知"}`,
    `- 原始链接：${note.url || ""}`, "", "## 正文", "",
    note.content || "（页面未提供可提取的正文）", "", "## 标签", "",
    (note.tags || []).join(" ") || "（无）", ""
  ].join("\n");
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function createZip(entries) {
  const parts = [];
  const centralParts = [];
  let offset = 0;
  const stamp = dosDateTime();

  for (const entry of entries) {
    const name = encoder.encode(entry.name.replace(/\\/g, "/"));
    const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, stamp.time, true);
    localView.setUint16(12, stamp.date, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    parts.push(local, data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, stamp.time, true);
    centralView.setUint16(14, stamp.date, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  return new Blob([...parts, ...centralParts, end], { type: "application/zip" });
}

function extensionFor(url, contentType, fallback) {
  const match = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i);
  if (match) return match[1].toLowerCase();
  const types = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
    "image/avif": "avif", "image/gif": "gif", "video/mp4": "mp4", "video/webm": "webm"
  };
  return types[String(contentType || "").split(";")[0].toLowerCase()] || fallback;
}

async function fetchEntry(url, pathWithoutExtension, fallbackExtension) {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = new Uint8Array(await response.arrayBuffer());
  return {
    name: `${pathWithoutExtension}.${extensionFor(url, response.headers.get("content-type"), fallbackExtension)}`,
    data
  };
}

async function buildArchive(job, notes) {
  const root = safeSegment(job.archiveName || "小红书归档");
  const entries = [];
  const usedFolders = new Set();
  let processed = 0;
  const total = Math.max(1, notes.length);

  for (const note of notes) {
    let folder = safeSegment(note.title || note.noteId, "无标题笔记");
    if (usedFolders.has(folder)) folder = `${folder}_${String(note.noteId).slice(-6)}`;
    usedFolders.add(folder);
    const base = `${root}/${folder}`;
    const title = safeSegment(note.title || "正文", "正文");
    entries.push({ name: `${base}/${title}.md`, data: encoder.encode(markdownForNote(note)) });
    const failures = [];
    let number = 1;
    const media = [
      ...[...new Set([...(note.imageUrls || []), note.coverUrl].filter(Boolean))].map((url) => ({ url, fallback: "jpg" })),
      ...[...new Set(note.videoUrls || [])].map((url) => ({ url, fallback: "mp4" }))
    ];
    for (const item of media) {
      statusElement.textContent = `正在读取：${note.title || note.noteId}（文件 ${number}）`;
      try {
        entries.push(await fetchEntry(item.url, `${base}/${number}`, item.fallback));
      } catch (error) {
        failures.push(`${number}. ${item.url}\n   ${error.message || error}`);
      }
      number += 1;
    }
    if (failures.length) entries.push({
      name: `${base}/下载失败.txt`,
      data: encoder.encode(failures.join("\n\n"))
    });
    processed += 1;
    progressElement.style.width = `${Math.round((processed / total) * 90)}%`;
  }
  return { root, blob: createZip(entries), fileCount: entries.length };
}

async function runArchive() {
  const jobId = new URLSearchParams(location.search).get("job");
  if (!jobId) throw new Error("缺少归档任务 ID。");
  const { job, notes } = await send({ type: "GET_ARCHIVE_JOB", jobId });
  if (!notes.length) throw new Error("没有找到可归档的笔记数据。");
  const archive = await buildArchive(job, notes);
  statusElement.textContent = "正在写入一个 ZIP 文件……";
  const url = URL.createObjectURL(archive.blob);
  await chrome.downloads.download({
    url,
    filename: `${archive.root}.zip`,
    saveAs: false,
    conflictAction: "uniquify"
  });
  progressElement.style.width = "100%";
  statusElement.textContent = `完成：${notes.length} 篇笔记、${archive.fileCount} 个归档文件，只下载了一个 ZIP。`;
  await send({ type: "FINISH_ARCHIVE_JOB", jobId });
  setTimeout(async () => {
    URL.revokeObjectURL(url);
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id) chrome.tabs.remove(tab.id);
  }, 5000);
}

globalThis.__XHS_ARCHIVE_TEST__ = {
  safeSegment,
  markdownForNote,
  crc32,
  createZip,
  extensionFor,
  buildArchive
};

if (globalThis.chrome?.runtime?.id) {
  runArchive().catch((error) => {
    document.querySelector("#archiveTitle").textContent = "归档失败";
    statusElement.textContent = error.message || String(error);
    progressElement.style.width = "0%";
  });
}
