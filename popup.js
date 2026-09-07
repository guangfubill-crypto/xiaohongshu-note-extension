"use strict";

const ui = {
  keyword: document.querySelector("#keyword"),
  scrollRounds: document.querySelector("#scrollRounds"),
  detailLimit: document.querySelector("#detailLimit"),
  delaySeconds: document.querySelector("#delaySeconds"),
  autoDownload: document.querySelector("#autoDownload"),
  startKeyword: document.querySelector("#startKeyword"),
  urlItems: document.querySelector("#urlItems"),
  startUrls: document.querySelector("#startUrls"),
  pauseTask: document.querySelector("#pauseTask"),
  resumeTask: document.querySelector("#resumeTask"),
  stopTask: document.querySelector("#stopTask"),
  captureCurrent: document.querySelector("#captureCurrent"),
  downloadCurrent: document.querySelector("#downloadCurrent"),
  openDashboard: document.querySelector("#openDashboard"),
  openStudio: document.querySelector("#openStudio"),
  statusDot: document.querySelector("#statusDot"),
  statusTitle: document.querySelector("#statusTitle"),
  statusProgress: document.querySelector("#statusProgress"),
  statusMessage: document.querySelector("#statusMessage"),
  progressBar: document.querySelector("#progressBar")
};

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "操作失败");
  return response.result;
}

function showTransient(title, message, type = "idle") {
  ui.statusTitle.textContent = title;
  ui.statusMessage.textContent = message;
  ui.statusDot.className = `status-dot ${type}`;
}

function renderTask(task) {
  const inSearch = task.phase === "search";
  const total = inSearch ? 1 : task.queue?.length || 0;
  const current = inSearch ? (task.foundCount > 0 ? 1 : 0) : Math.min(task.index || 0, total);
  const progress = task.status === "completed" ? 100 : total ? Math.round((current / total) * 100) : 0;
  const titles = {
    idle: "准备就绪",
    running: inSearch ? "正在搜索笔记" : "正在采集详情",
    paused: "已暂停",
    stopped: "已停止",
    completed: "采集完成",
    error: "发生错误"
  };
  ui.statusTitle.textContent = titles[task.status] || task.status;
  ui.statusProgress.textContent = inSearch ? `搜索 ${current}/1` : `${current}/${total}`;
  ui.statusMessage.textContent = task.message || "";
  ui.progressBar.style.width = `${progress}%`;
  ui.statusDot.className = `status-dot ${task.status || "idle"}`;
  ui.pauseTask.disabled = task.status !== "running";
  ui.resumeTask.disabled = !["paused", "error"].includes(task.status);
  ui.stopTask.disabled = !["running", "paused"].includes(task.status);
}

async function refreshTask() {
  try {
    renderTask(await send({ type: "GET_TASK" }));
  } catch (error) {
    showTransient("状态读取失败", error.message, "error");
  }
}

ui.startKeyword.addEventListener("click", async () => {
  ui.startKeyword.disabled = true;
  try {
    renderTask(await send({
      type: "START_KEYWORD",
      keyword: ui.keyword.value,
      scrollRounds: Number(ui.scrollRounds.value),
      detailLimit: Number(ui.detailLimit.value),
      delaySeconds: Number(ui.delaySeconds.value),
      autoDownload: ui.autoDownload.checked
    }));
  } catch (error) {
    showTransient("无法开始", error.message, "error");
  } finally {
    ui.startKeyword.disabled = false;
  }
});

ui.keyword.addEventListener("keydown", (event) => {
  if (event.key === "Enter") ui.startKeyword.click();
});

ui.startUrls.addEventListener("click", async () => {
  try {
    renderTask(await send({
      type: "START_URLS",
      items: ui.urlItems.value,
      delaySeconds: Number(ui.delaySeconds.value),
      autoDownload: ui.autoDownload.checked
    }));
  } catch (error) {
    showTransient("无法开始", error.message, "error");
  }
});

ui.captureCurrent.addEventListener("click", async () => {
  ui.captureCurrent.disabled = true;
  showTransient("正在读取", "正在分析当前小红书页面……", "running");
  try {
    const result = await send({ type: "CAPTURE_ACTIVE" });
    if (result.blocked) showTransient("需要人工处理", result.reason, "paused");
    else showTransient("采集成功", `已保存 ${result.saved} 篇笔记。`, "completed");
  } catch (error) {
    showTransient("采集失败", error.message, "error");
  } finally {
    ui.captureCurrent.disabled = false;
  }
});

ui.downloadCurrent.addEventListener("click", async () => {
  ui.downloadCurrent.disabled = true;
  showTransient("正在归档", "正在提取正文、图片和视频链接……", "running");
  try {
    const result = await send({ type: "CAPTURE_AND_DOWNLOAD_ACTIVE" });
    if (result.blocked) {
      showTransient("需要人工处理", result.reason, "paused");
    } else {
      const download = result.download || {};
      showTransient(
        "正在生成 ZIP",
        `正在打包 ${download.noteCount || 0} 篇笔记，完成后只会下载一个 ZIP。`,
        "completed"
      );
    }
  } catch (error) {
    showTransient("下载失败", error.message, "error");
  } finally {
    ui.downloadCurrent.disabled = false;
  }
});

ui.openDashboard.addEventListener("click", async () => {
  await send({ type: "OPEN_DASHBOARD" });
  window.close();
});

ui.openStudio.addEventListener("click", async () => {
  await send({ type: "OPEN_STUDIO" });
  window.close();
});

ui.pauseTask.addEventListener("click", async () => renderTask(await send({ type: "PAUSE_TASK" })));
ui.resumeTask.addEventListener("click", async () => renderTask(await send({ type: "RESUME_TASK" })));
ui.stopTask.addEventListener("click", async () => renderTask(await send({ type: "STOP_TASK" })));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.collectorTask) renderTask(changes.collectorTask.newValue);
});

refreshTask();
