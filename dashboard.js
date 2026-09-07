"use strict";

const ui = {
  notes: document.querySelector("#metricNotes"),
  likes: document.querySelector("#metricLikes"),
  collects: document.querySelector("#metricCollects"),
  comments: document.querySelector("#metricComments"),
  search: document.querySelector("#searchInput"),
  keyword: document.querySelector("#keywordFilter"),
  sort: document.querySelector("#sortBy"),
  rows: document.querySelector("#noteRows"),
  empty: document.querySelector("#emptyState"),
  rowCount: document.querySelector("#rowCount"),
  refresh: document.querySelector("#refreshData"),
  openStudio: document.querySelector("#openStudio"),
  downloadVisible: document.querySelector("#downloadVisible"),
  export: document.querySelector("#exportCsv"),
  clear: document.querySelector("#clearData"),
  downloadStatus: document.querySelector("#downloadStatus")
};

let allNotes = [];
let visibleNotes = [];

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "操作失败");
  return response.result;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeNoteUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return "#";
    if (!(url.hostname === "xiaohongshu.com" || url.hostname.endsWith(".xiaohongshu.com"))) return "#";
    return url.href;
  } catch {
    return "#";
  }
}

function formatNumber(value, digits = 0) {
  return Number.isFinite(value)
    ? new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(value)
    : "—";
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function average(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function selectedNotes() {
  const query = ui.search.value.trim().toLowerCase();
  const keyword = ui.keyword.value;
  const [field, direction] = ui.sort.value.split("-");
  const multiplier = direction === "asc" ? 1 : -1;
  return allNotes
    .filter((note) => {
      if (keyword && !(note.sourceKeywords || []).includes(keyword)) return false;
      if (!query) return true;
      return [
        note.noteId, note.title, note.content, note.author,
        ...(note.tags || []), ...(note.sourceKeywords || [])
      ].some((value) => String(value || "").toLowerCase().includes(query));
    })
    .sort((a, b) => {
      const left = a[field];
      const right = b[field];
      if (field === "lastSeen") return (new Date(left || 0) - new Date(right || 0)) * multiplier;
      if (Number.isFinite(left) || Number.isFinite(right)) {
        if (!Number.isFinite(left)) return 1;
        if (!Number.isFinite(right)) return -1;
        return (left - right) * multiplier;
      }
      return String(left || "").localeCompare(String(right || "")) * multiplier;
    });
}

function renderMetrics(notes) {
  ui.notes.textContent = formatNumber(notes.length);
  const avgLikes = average(notes.map((note) => note.likes));
  ui.likes.textContent = avgLikes === null ? "—" : formatNumber(avgLikes);
  ui.collects.textContent = formatNumber(notes.reduce((sum, note) => sum + (Number(note.collects) || 0), 0));
  ui.comments.textContent = formatNumber(notes.reduce((sum, note) => sum + (Number(note.comments) || 0), 0));
}

function renderRows(notes) {
  ui.rows.innerHTML = notes.map((note) => {
    const tags = (note.tags || []).join(" ") || "—";
    const published = [note.publishedAt, note.ipLocation ? `IP ${note.ipLocation}` : ""].filter(Boolean).join(" · ") || "—";
    const format = [note.hasVideo ? "视频" : "图文", note.imageCount ? `${note.imageCount} 图` : ""].filter(Boolean).join(" · ");
    const media = `${(note.imageUrls || []).length} 图 · ${(note.videoUrls || []).length} 视频`;
    return `<tr>
      <td class="note-cell">
        <a href="${escapeHtml(safeNoteUrl(note.url))}" target="_blank" rel="noreferrer">${escapeHtml(note.title || note.noteId)}</a>
        <p>${escapeHtml(note.content || "")}</p>
        <div class="meta"><code>${escapeHtml(note.noteId)}</code><span>排名 ${note.searchRank || "—"}</span></div>
      </td>
      <td class="wrap-cell">${escapeHtml((note.sourceKeywords || []).join("、") || "—")}</td>
      <td class="wrap-cell">${escapeHtml(note.author || "—")}</td>
      <td><strong>${formatNumber(note.likes)}</strong></td>
      <td>${formatNumber(note.collects)}</td>
      <td>${formatNumber(note.comments)}</td>
      <td class="tags-cell">${escapeHtml(tags)}</td>
      <td class="wrap-cell">${escapeHtml(published)}</td>
      <td>${escapeHtml(format)}</td>
      <td>${escapeHtml(media)}</td>
      <td>${escapeHtml(formatDate(note.lastSeen))}</td>
      <td><button class="download-note" data-note-id="${escapeHtml(note.noteId)}">打包</button></td>
    </tr>`;
  }).join("");
  ui.empty.hidden = notes.length > 0;
  ui.rowCount.textContent = `显示 ${notes.length} 篇笔记`;
}

function render() {
  visibleNotes = selectedNotes();
  renderMetrics(visibleNotes);
  renderRows(visibleNotes);
}

function renderKeywordOptions() {
  const current = ui.keyword.value;
  const keywords = [...new Set(allNotes.flatMap((note) => note.sourceKeywords || []))].sort();
  ui.keyword.innerHTML = `<option value="">全部来源关键词</option>${keywords
    .map((keyword) => `<option value="${escapeHtml(keyword)}">${escapeHtml(keyword)}</option>`)
    .join("")}`;
  if (keywords.includes(current)) ui.keyword.value = current;
}

async function loadData() {
  const result = await send({ type: "GET_NOTES" });
  allNotes = result.notes || [];
  renderKeywordOptions();
  render();
}

async function downloadNotes(noteIds) {
  if (!noteIds.length) return;
  ui.downloadStatus.textContent = `正在创建 ${noteIds.length} 篇归档……`;
  ui.downloadVisible.disabled = true;
  try {
    const result = await send({
      type: "DOWNLOAD_NOTES",
      noteIds,
      archiveName: ui.keyword.value || (noteIds.length === 1 ? "小红书笔记" : "小红书批量归档")
    });
    ui.downloadStatus.textContent = `正在打包 ${result.noteCount} 篇笔记；完成后只下载一个 ZIP`;
  } catch (error) {
    ui.downloadStatus.textContent = `下载失败：${error.message}`;
  } finally {
    ui.downloadVisible.disabled = false;
  }
}

function csvCell(value) {
  let normalized = Array.isArray(value) ? JSON.stringify(value) : String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(normalized)) normalized = `'${normalized}`;
  return `"${normalized.replace(/"/g, '""')}"`;
}

function exportCsv() {
  if (!visibleNotes.length) return;
  const columns = [
    ["笔记ID", "noteId"], ["来源关键词", "sourceKeywords"], ["搜索排名", "searchRank"],
    ["标题", "title"], ["正文", "content"], ["作者", "author"], ["作者链接", "authorUrl"],
    ["点赞数", "likes"], ["收藏数", "collects"], ["评论数", "comments"], ["标签", "tags"],
    ["发布时间", "publishedAt"], ["IP属地", "ipLocation"], ["图片数", "imageCount"],
    ["是否视频", "hasVideo"], ["封面", "coverUrl"], ["图片链接", "imageUrls"],
    ["视频链接", "videoUrls"], ["笔记链接", "url"], ["最后采集", "lastSeen"]
  ];
  const rows = [columns.map(([label]) => csvCell(label)).join(",")];
  for (const note of visibleNotes) rows.push(columns.map(([, key]) => csvCell(note[key])).join(","));
  const blob = new Blob(["\ufeff", rows.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `xiaohongshu-notes-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

ui.search.addEventListener("input", render);
ui.keyword.addEventListener("change", render);
ui.sort.addEventListener("change", render);
ui.refresh.addEventListener("click", loadData);
ui.openStudio.addEventListener("click", () => send({ type: "OPEN_STUDIO" }));
ui.downloadVisible.addEventListener("click", async () => {
  if (!visibleNotes.length) return;
  if (!confirm(`将把当前筛选的 ${visibleNotes.length} 篇笔记正文和媒体打成一个 ZIP，是否继续？`)) return;
  await downloadNotes(visibleNotes.map((note) => note.noteId));
});
ui.export.addEventListener("click", exportCsv);
ui.rows.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-note-id]");
  if (!button) return;
  button.disabled = true;
  await downloadNotes([button.dataset.noteId]);
  button.disabled = false;
});
ui.clear.addEventListener("click", async () => {
  if (!confirm("确定清空全部笔记和历史快照吗？此操作无法撤销。")) return;
  await send({ type: "CLEAR_NOTES" });
  await loadData();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.notesById || changes.noteHistory)) loadData();
});

loadData();
