(() => {
  "use strict";

  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function textFrom(root, selectors) {
    for (const selector of selectors) {
      const element = root.querySelector(selector);
      const value = clean(element?.textContent);
      if (value) return value;
    }
    return "";
  }

  function absoluteUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(value, location.origin);
      if (!["http:", "https:"].includes(url.protocol)) return "";
      if (!(url.hostname === "xiaohongshu.com" || url.hostname.endsWith(".xiaohongshu.com"))) return "";
      return url.href;
    } catch {
      return "";
    }
  }

  function assetUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(value, location.origin);
      if (url.protocol !== "https:") return "";
      const allowed = ["xiaohongshu.com", "xhscdn.com", "xhscdn.net"];
      return allowed.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`))
        ? url.href
        : "";
    } catch {
      return "";
    }
  }

  function noteIdFromUrl(value) {
    const match = String(value || "").match(/\/(?:explore|search_result|discovery\/item)\/([a-f0-9]{16,32})(?:[/?#]|$)/i);
    return match ? match[1].toLowerCase() : "";
  }

  function parseCount(value) {
    const normalized = clean(value).replace(/,/g, "").toLowerCase();
    const match = normalized.match(/(\d+(?:\.\d+)?)\s*(万|w|k)?/i);
    if (!match) return null;
    const number = Number(match[1]);
    const unit = match[2]?.toLowerCase();
    if (!Number.isFinite(number)) return null;
    if (unit === "万" || unit === "w") return Math.round(number * 10000);
    if (unit === "k") return Math.round(number * 1000);
    return Math.round(number);
  }

  function firstImage(root) {
    const image = root.querySelector("img");
    return assetUrl(image?.currentSrc || image?.src || image?.getAttribute("data-src"));
  }

  function mediaFromElements(root, selector, attributes) {
    const urls = [];
    root.querySelectorAll(selector).forEach((element) => {
      for (const attribute of attributes) {
        const raw = attribute === "currentSrc" ? element.currentSrc : element.getAttribute(attribute);
        const url = assetUrl(raw);
        if (url) urls.push(url);
      }
    });
    return [...new Set(urls)];
  }

  function mediaFromMetadata(kind) {
    const selectors = kind === "video"
      ? [
          "meta[property='og:video']",
          "meta[property='og:video:url']",
          "meta[property='og:video:secure_url']",
          "meta[name='twitter:player:stream']"
        ]
      : ["meta[property='og:image']", "meta[name='twitter:image']"];
    const urls = [];
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((element) => {
        const url = assetUrl(element.getAttribute("content"));
        if (url) urls.push(url);
      });
    }
    return [...new Set(urls)];
  }

  function mediaFromScripts(noteId, kind) {
    if (!noteId) return [];
    const results = [];
    for (const script of document.scripts) {
      const source = script.textContent || "";
      if (!source.includes(noteId)) continue;
      const decoded = source
        .replace(/\\u002F/gi, "/")
        .replace(/\\u0026/gi, "&")
        .replace(/\\\//g, "/")
        .replace(/&amp;/g, "&");
      const matches = decoded.match(/https?:\/\/[^"'\\<>\s]+/g) || [];
      for (const raw of matches) {
        const url = assetUrl(raw.replace(/[),}\]]+$/, ""));
        if (!url) continue;
        const lower = url.toLowerCase();
        const isVideo = /sns-video|\.(?:mp4|m4v|mov|webm)(?:[?#]|$)|\/video\//i.test(lower);
        const isImage = /sns-webpic|ci\.xiaohongshu|\.(?:jpe?g|png|webp|avif|gif)(?:[?#]|$)|\/image\//i.test(lower);
        if ((kind === "video" && isVideo) || (kind === "image" && isImage)) results.push(url);
      }
    }
    return [...new Set(results)].slice(0, kind === "video" ? 5 : 50);
  }

  function findCard(anchor) {
    return anchor.closest("section.note-item, section[class*='note-item'], article, [class*='note-item'], .note-item")
      || anchor.parentElement?.parentElement
      || anchor.parentElement;
  }

  function isNoteHref(value) {
    return /\/(?:explore|search_result|discovery\/item)\/[a-f0-9]{16,32}(?:[/?#]|$)/i.test(value || "");
  }

  function extractSearchNotes() {
    const notes = [];
    const seen = new Set();
    const anchors = document.querySelectorAll(
      "a[href*='/explore/'], a[href*='/search_result/'], a[href*='/discovery/item/']"
    );

    for (const anchor of anchors) {
      const url = absoluteUrl(anchor.href || anchor.getAttribute("href"));
      const noteId = noteIdFromUrl(url);
      if (!noteId || seen.has(noteId) || !isNoteHref(url)) continue;
      const card = findCard(anchor);
      if (!card) continue;
      const authorAnchor = card.querySelector("a[href*='/user/profile/']");
      const title = textFrom(card, [
        "a.title span",
        "a.title",
        "[class~='title'] span",
        "[class~='title']",
        "[class*='note-title']"
      ]) || clean(anchor.getAttribute("aria-label") || anchor.title);
      const likesText = textFrom(card, [
        ".like-wrapper .count",
        "[class*='like'] [class*='count']",
        "span.count"
      ]);
      const coverUrl = firstImage(card);
      const cardVideoUrls = mediaFromElements(card, "video, video source", ["currentSrc", "src"]);
      if (!title && !authorAnchor && !firstImage(card)) continue;
      seen.add(noteId);
      notes.push({
        noteId,
        pageType: "search",
        title,
        content: "",
        author: clean(authorAnchor?.textContent),
        authorUrl: absoluteUrl(authorAnchor?.href),
        likesText,
        likes: parseCount(likesText),
        collectsText: "",
        collects: null,
        commentsText: "",
        comments: null,
        tags: [],
        publishedAt: textFrom(card, [".date", "[class*='publish-time']", "time"]),
        ipLocation: "",
        coverUrl,
        imageUrls: coverUrl ? [coverUrl] : [],
        videoUrls: cardVideoUrls,
        imageCount: card.querySelectorAll("img").length || null,
        hasVideo: cardVideoUrls.length > 0 || Boolean(card.querySelector("video, [class*='video']")),
        url,
        capturedAt: new Date().toISOString()
      });
    }
    return notes;
  }

  function interactionValue(kind) {
    const selectorsByKind = {
      likes: [
        ".like-wrapper .count", "[class*='like-wrapper'] [class*='count']",
        "[data-testid*='like'] [class*='count']", "[aria-label*='点赞']"
      ],
      collects: [
        ".collect-wrapper .count", "[class*='collect-wrapper'] [class*='count']",
        "[data-testid*='collect'] [class*='count']", "[aria-label*='收藏']"
      ],
      comments: [
        ".chat-wrapper .count", ".comment-wrapper .count",
        "[class*='chat-wrapper'] [class*='count']", "[class*='comment-wrapper'] [class*='count']",
        "[data-testid*='comment'] [class*='count']", "[aria-label*='评论']"
      ]
    };
    return textFrom(document, selectorsByKind[kind] || []);
  }

  function extractTags(content) {
    const values = [];
    document.querySelectorAll(
      "#detail-desc a[href*='keyword='], .note-content a[href*='keyword='], a.tag"
    ).forEach((element) => {
      const value = clean(element.textContent);
      if (value) values.push(value.startsWith("#") ? value : `#${value}`);
    });
    for (const match of content.matchAll(/#[^#\s，。！？、]{1,30}/g)) values.push(match[0]);
    return [...new Set(values)];
  }

  function extractDetailNote() {
    const canonical = document.querySelector("link[rel='canonical']")?.href || location.href;
    const url = absoluteUrl(canonical);
    const noteId = noteIdFromUrl(url) || noteIdFromUrl(location.href);
    const detailRoot = document.querySelector("#noteContainer, .note-detail-mask, [class*='note-detail'], .note-content") || document;
    const authorAnchor = detailRoot.querySelector("a[href*='/user/profile/']")
      || document.querySelector("a[href*='/user/profile/']");
    const title = textFrom(detailRoot, [
      "#detail-title", ".note-content .title", "[class*='note-content'] [class~='title']",
      "[class*='detail'] [class*='title']", "h1"
    ]);
    const content = textFrom(detailRoot, [
      "#detail-desc", ".note-content .desc", "[class*='note-content'] [class~='desc']",
      "[class*='detail'] [class*='desc']", ".note-text"
    ]);
    const likesText = interactionValue("likes");
    const collectsText = interactionValue("collects");
    const commentsText = interactionValue("comments");
    const dateText = textFrom(detailRoot, [
      ".bottom-container .date", "[class*='bottom-container'] [class*='date']",
      "[class*='publish-time']", "time", ".date"
    ]);
    const locationMatch = `${dateText} ${clean(detailRoot.textContent)}`.match(/IP属地[:：]?\s*([^\s|·]+)/);
    const domImages = mediaFromElements(
      detailRoot,
      ".swiper-slide img, [class*='carousel'] img, [class*='slider'] img, img.note-slider-img",
      ["currentSrc", "src", "data-src"]
    );
    const imageUrls = domImages.length ? domImages : mediaFromScripts(noteId, "image");
    const domVideoUrls = mediaFromElements(
      detailRoot,
      "video, video source",
      ["currentSrc", "src", "data-src"]
    );
    const metadataVideoUrls = mediaFromMetadata("video");
    const videoUrls = metadataVideoUrls.length
      ? metadataVideoUrls.slice(0, 1)
      : (domVideoUrls.length ? domVideoUrls : mediaFromScripts(noteId, "video").slice(0, 1));

    return {
      noteId,
      pageType: "detail",
      title,
      content,
      author: clean(authorAnchor?.textContent),
      authorUrl: absoluteUrl(authorAnchor?.href),
      likesText,
      likes: parseCount(likesText),
      collectsText,
      collects: parseCount(collectsText),
      commentsText,
      comments: parseCount(commentsText),
      tags: extractTags(content),
      publishedAt: dateText.replace(/IP属地[:：]?.*$/, "").trim(),
      ipLocation: locationMatch?.[1] || "",
      coverUrl: imageUrls[0] || firstImage(detailRoot),
      imageUrls,
      videoUrls,
      imageCount: imageUrls.length || null,
      hasVideo: videoUrls.length > 0 || Boolean(detailRoot.querySelector("video, [class*='video-player']")),
      url,
      capturedAt: new Date().toISOString()
    };
  }

  function isBlockedPage() {
    const bodyText = clean(document.body?.innerText).slice(0, 3000);
    return Boolean(
      document.querySelector("iframe[src*='captcha'], [class*='captcha'], [class*='verify-container']")
      || /请完成验证|访问过于频繁|安全验证|验证后继续/i.test(bodyText)
    );
  }

  function hasLoginWall() {
    const bodyText = clean(document.body?.innerText).slice(0, 3000);
    return Boolean(
      document.querySelector("[class*='login-container'], [class*='login-modal']")
      || /登录后查看|请先登录|扫码登录/i.test(bodyText)
    );
  }

  async function extractPage(scrollRounds = 0) {
    const noteId = noteIdFromUrl(location.href);
    const isDetail = Boolean(noteId);
    if (!isDetail) {
      const rounds = Math.min(10, Math.max(0, Number(scrollRounds) || 0));
      for (let index = 0; index < rounds; index += 1) {
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
        await wait(1200);
      }
    }

    const notes = isDetail ? [extractDetailNote()] : extractSearchNotes();
    if (!notes.filter((note) => note.noteId).length && (isBlockedPage() || hasLoginWall())) {
      return {
        blocked: true,
        reason: isBlockedPage()
          ? "检测到安全验证，请在当前标签页手动完成后继续。"
          : "当前页面需要登录，请先在小红书网页完成登录后继续。",
        notes: []
      };
    }
    return {
      blocked: false,
      pageType: isDetail ? "detail" : "search",
      pageTitle: document.title,
      url: location.href,
      notes: notes.filter((note) => note.noteId)
    };
  }

  function setEditorValue(element, value) {
    if (!element) return false;
    element.focus();
    if (element.matches("input, textarea")) {
      const prototype = element.matches("textarea") ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (setter) setter.call(element, value);
      else element.value = value;
    } else {
      element.textContent = value;
    }
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function findFirst(selectors, excluded = null) {
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (element !== excluded && element.offsetParent !== null) return element;
      }
    }
    return null;
  }

  async function fillPublishDraft(draft) {
    const titleSelectors = [
      "input[placeholder*='标题']", "textarea[placeholder*='标题']",
      "input[class*='title']", "textarea[class*='title']"
    ];
    const bodySelectors = [
      "[contenteditable='true'][data-placeholder*='正文']",
      "[contenteditable='true'][data-placeholder*='描述']",
      ".tiptap.ProseMirror", ".ql-editor[contenteditable='true']",
      "textarea[placeholder*='正文']", "textarea[placeholder*='描述']",
      "[contenteditable='true']"
    ];
    let titleElement = null;
    let bodyElement = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      titleElement = findFirst(titleSelectors);
      bodyElement = findFirst(bodySelectors, titleElement);
      if (titleElement && bodyElement) break;
      await wait(500);
    }
    if (!titleElement || !bodyElement) return { ok: false, error: "尚未找到标题或正文编辑框。请先上传图片/视频，再点击右侧“填入扩展草稿”。" };
    const body = [draft.body, draft.tags].filter(Boolean).join("\n\n");
    setEditorValue(titleElement, draft.title || "");
    setEditorValue(bodyElement, body);
    return { ok: true, message: "标题和正文已填入。请检查图片、话题和披露信息，再人工点击发布。" };
  }

  async function fillComment(comment) {
    const selectors = [
      "textarea[placeholder*='评论']", "textarea[placeholder*='说点什么']",
      "[contenteditable='true'][data-placeholder*='评论']",
      "[contenteditable='true'][data-placeholder*='说点什么']",
      "[class*='comment'] [contenteditable='true']"
    ];
    let editor = null;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      editor = findFirst(selectors);
      if (editor) break;
      await wait(350);
    }
    if (!editor) return { ok: false, error: "没有找到评论输入框。请先展开评论区，再从助手重试。" };
    setEditorValue(editor, comment);
    editor.scrollIntoView({ block: "center", behavior: "smooth" });
    return { ok: true, message: "评论已填入，最终发送请你人工确认。" };
  }

  function showAssistBanner(message, buttonText, onClick) {
    document.querySelector("#xhs-extension-assist")?.remove();
    const panel = document.createElement("aside");
    panel.id = "xhs-extension-assist";
    panel.style.cssText = "position:fixed;right:22px;bottom:22px;z-index:2147483647;width:min(330px,calc(100vw - 44px));padding:14px;color:#202331;background:#fff;border:1px solid #e9e9ed;border-radius:14px;box-shadow:0 12px 38px rgba(31,36,48,.2);font-family:PingFang SC,Microsoft YaHei,sans-serif";
    const title = document.createElement("strong");
    title.textContent = "小红书安全助手";
    const text = document.createElement("span");
    text.textContent = message;
    text.style.cssText = "display:block;margin:6px 0 10px;color:#707784;font-size:12px;line-height:1.45";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = buttonText;
    button.style.cssText = "width:100%;border:0;border-radius:9px;padding:10px;color:#fff;background:#ff2442;font-weight:700;cursor:pointer";
    button.addEventListener("click", onClick);
    panel.append(title, text, button);
    document.body.append(panel);
    return { panel, text, button };
  }

  async function setupCreatorAssist() {
    const response = await chrome.runtime.sendMessage({ type: "GET_ACTIVE_PUBLISH_DRAFT" });
    const draft = response?.ok ? response.result : null;
    if (!draft) return;
    const banner = showAssistBanner(
      "草稿已准备。先在官方页面上传图片或视频，然后点击下方按钮填入标题和正文。",
      "填入扩展草稿",
      async () => {
        banner.button.disabled = true;
        const result = await fillPublishDraft(draft);
        banner.text.textContent = result.message || result.error;
        banner.button.disabled = false;
      }
    );
    const immediate = await fillPublishDraft(draft);
    if (immediate.ok) banner.text.textContent = immediate.message;
  }

  if (globalThis.__XHS_ENABLE_TEST_HOOKS__) {
    globalThis.__XHS_CONTENT_TEST__ = {
      assetUrl,
      mediaFromMetadata,
      setEditorValue,
      fillPublishDraft,
      fillComment
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    let operation = null;
    if (message?.type === "XHS_EXTRACT") operation = extractPage(message.scrollRounds);
    if (message?.type === "XHS_FILL_PUBLISHER") operation = fillPublishDraft(message.draft || {});
    if (message?.type === "XHS_FILL_COMMENT") operation = fillComment(String(message.comment || ""));
    if (!operation) return false;
    operation
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        notes: []
      }));
    return true;
  });

  if (location.hostname === "creator.xiaohongshu.com") setupCreatorAssist().catch(() => {});
})();
