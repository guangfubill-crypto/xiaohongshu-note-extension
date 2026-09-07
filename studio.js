"use strict";

const ui = Object.fromEntries([
  "draftTitle", "draftBody", "draftTags", "commercialDraft", "draftSaved", "draftReview",
  "reviewDraft", "preparePublish", "commentUrl", "commentTemplate", "commentText",
  "commentReview", "reviewComment", "prepareComment", "commentQuota", "openDashboard"
].map((id) => [id, document.querySelector(`#${id}`)]));

const params = new URLSearchParams(location.search);
const sourceTabId = Number(params.get("sourceTabId")) || null;
const sourceUrl = params.get("sourceUrl") || "";
let saveTimer = null;

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "操作失败");
  return response.result;
}

function draftValue() {
  return {
    title: ui.draftTitle.value.trim(),
    body: ui.draftBody.value.trim(),
    tags: ui.draftTags.value.trim(),
    commercial: ui.commercialDraft.checked,
    updatedAt: new Date().toISOString()
  };
}

function renderReview(element, review, successText) {
  if (!review.findings.length) {
    element.className = "review-box success";
    element.textContent = successText;
    return;
  }
  element.className = `review-box ${review.blockers.length ? "danger" : "warning"}`;
  element.innerHTML = review.findings.map((item) => `
    <div class="finding"><strong>${item.severity === "block" ? "⛔" : "⚠️"} ${item.label}</strong>
    ${item.matches.length ? `<span>命中：${item.matches.map(escapeHtml).join("、")}</span>` : ""}
    <small>${escapeHtml(item.suggestion)}</small></div>`).join("");
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function reviewDraftNow() {
  const draft = draftValue();
  const review = XhsSafety.reviewText(`${draft.title}\n${draft.body}\n${draft.tags}`, { mode: "draft" });
  if (!draft.title || !draft.body) review.findings.unshift({
    id: "required", label: "标题和正文不能为空", severity: "block", matches: [], suggestion: "补全草稿后再打开发布页。"
  });
  if (draft.commercial) review.findings.push({
    id: "commercial", label: "商业内容报备提醒", severity: "warn", matches: [], suggestion: "请通过平台要求的商业合作流程报备，并如实披露合作关系。"
  });
  review.blockers = review.findings.filter((item) => item.severity === "block");
  review.warnings = review.findings.filter((item) => item.severity === "warn");
  review.ok = review.blockers.length === 0;
  renderReview(ui.draftReview, review, "✅ 未发现常见导流、承诺或功效风险；发布前仍请人工通读。" );
  return review;
}

function reviewCommentNow() {
  const review = XhsSafety.reviewText(ui.commentText.value, { mode: "comment" });
  renderReview(ui.commentReview, review, "✅ 话术通过基础检查；请确认它与当前笔记具体相关。" );
  return review;
}

async function saveDraft() {
  await chrome.storage.local.set({ publisherDraft: draftValue() });
  ui.draftSaved.textContent = "已保存到本机";
}

function scheduleSave() {
  ui.draftSaved.textContent = "保存中…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveDraft().catch(() => { ui.draftSaved.textContent = "保存失败"; }), 350);
}

async function refreshQuota() {
  const result = await send({ type: "GET_COMMENT_LIMITS" });
  ui.commentQuota.textContent = `今日 ${result.todayCount}/10`;
}

for (const element of [ui.draftTitle, ui.draftBody, ui.draftTags, ui.commercialDraft]) {
  element.addEventListener("input", scheduleSave);
  element.addEventListener("change", scheduleSave);
}

ui.reviewDraft.addEventListener("click", reviewDraftNow);
ui.reviewComment.addEventListener("click", reviewCommentNow);
ui.commentTemplate.addEventListener("change", () => {
  if (ui.commentTemplate.value) ui.commentText.value = ui.commentTemplate.value;
  reviewCommentNow();
});

ui.preparePublish.addEventListener("click", async () => {
  const review = reviewDraftNow();
  if (!review.ok) return;
  if (review.warnings.length && !confirm("草稿仍有风险提示。你已经核对真实依据和平台报备要求，仍要填入发布页吗？")) return;
  ui.preparePublish.disabled = true;
  try {
    await saveDraft();
    await send({ type: "PREPARE_PUBLISH", draft: draftValue(), acknowledged: true });
    ui.draftReview.className = "review-box success";
    ui.draftReview.textContent = "已打开官方发布页。上传图片/视频后，点击页面右侧的“填入扩展草稿”；最终发布请你人工确认。";
  } catch (error) {
    ui.draftReview.className = "review-box danger";
    ui.draftReview.textContent = error.message;
  } finally {
    ui.preparePublish.disabled = false;
  }
});

ui.prepareComment.addEventListener("click", async () => {
  const review = reviewCommentNow();
  if (!review.ok) return;
  ui.prepareComment.disabled = true;
  try {
    const result = await send({
      type: "PREPARE_COMMENT",
      comment: ui.commentText.value.trim(),
      targetUrl: ui.commentUrl.value.trim(),
      sourceTabId
    });
    ui.commentReview.className = "review-box success";
    ui.commentReview.textContent = result.message || "评论已填入；请在页面确认后手动发送。";
    await refreshQuota();
  } catch (error) {
    ui.commentReview.className = "review-box danger";
    ui.commentReview.textContent = error.message;
  } finally {
    ui.prepareComment.disabled = false;
  }
});

ui.openDashboard.addEventListener("click", () => send({ type: "OPEN_DASHBOARD" }));

(async () => {
  const data = await chrome.storage.local.get("publisherDraft");
  const draft = data.publisherDraft || {};
  ui.draftTitle.value = draft.title || "";
  ui.draftBody.value = draft.body || "";
  ui.draftTags.value = draft.tags || "";
  ui.commercialDraft.checked = Boolean(draft.commercial);
  if (/^https:\/\/[^/]*xiaohongshu\.com\/(?:explore|search_result|discovery\/item)\//i.test(sourceUrl)) ui.commentUrl.value = sourceUrl;
  await refreshQuota();
})().catch((error) => {
  ui.commentReview.className = "review-box danger";
  ui.commentReview.textContent = error.message;
});
