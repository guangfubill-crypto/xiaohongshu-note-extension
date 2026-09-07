# Xiaohongshu Note Collector, Archive & Publishing Assistant

**Language:** English · [中文](README_ZH.md)

A pure Chrome/Edge Manifest V3 browser extension for collecting public Xiaohongshu notes through the real browser, then archiving text, images, and accessible videos into a single ZIP file.

It also provides local drafts, publishing-page autofill, and cautious comment assistance. The extension never clicks the final “Publish” or “Send” button for you, and it does not provide unattended bulk posting, automated likes/follows, or off-platform promotion.

[![Latest Release](https://img.shields.io/github/v/release/guangfubill-crypto/xiaohongshu-note-extension?display_name=tag)](https://github.com/guangfubill-crypto/xiaohongshu-note-extension/releases)
[![License](https://img.shields.io/github/license/guangfubill-crypto/xiaohongshu-note-extension)](LICENSE)

## Features

- Search Xiaohongshu by keyword and scroll through public notes
- Collect note details from complete result URLs, including title, body, author, engagement counts, tags, date, and visible IP location
- Download Markdown, images, and accessible videos as one ZIP archive
- Detect notes whose player only exposes a `blob:` URL but whose page provides a signed MP4 through `og:video`
- Local dashboard with search, filtering, sorting, CSV export, and single/batch archiving
- Publishing assistant with local drafts, text checks, and official creator-page autofill
- Comment assistant with cautious templates, risk checks, duplicate detection, and rate limits

## Installation

### Download

Download the latest ZIP from [Releases](https://github.com/guangfubill-crypto/xiaohongshu-note-extension/releases), for example [v0.4.0](https://github.com/guangfubill-crypto/xiaohongshu-note-extension/releases/tag/v0.4.0).

### Load the extension

1. Extract the ZIP file.
2. Open `chrome://extensions/` in Chrome or `edge://extensions/` in Edge.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the folder that contains `manifest.json`.
6. Pin the extension to the browser toolbar if useful.

Before first use, sign in to [Xiaohongshu](https://www.xiaohongshu.com/) in the same browser. The extension reuses the current browser session and does not read or export cookies.

## Collect notes

### Keyword collection

1. Click the extension icon and enter a keyword, such as `shower room` or `淋浴房`.
2. Choose scroll rounds, detail count, and request interval.
3. Click **Start keyword collection**.
4. When finished, use the dashboard to search, filter, sort, or export CSV.

Set the detail count to `0` to save search results without opening detail pages. Use a reasonable interval and pause for any security verification shown by the site.

### Batch URL collection

Paste one complete Xiaohongshu note URL per line. Detail collection relies on the `xsec_token` in the URL; do not paste only a bare note ID or remove the URL parameters.

### Single-note collection

Open a Xiaohongshu note detail page and click **Collect current page and download one ZIP** in the extension popup.

## ZIP structure

Each collection task creates one ZIP. Note titles are used as folders; invalid filename characters are replaced, and duplicate titles receive a short ID suffix.

```text
xiaohongshu-archive.zip
└── xiaohongshu-archive/
    └── Note title/
        ├── Note title.md
        ├── 1.webp
        ├── 2.webp
        └── 3.mp4
```

Media files are numbered in extraction order, with images and videos sharing the same sequence. The extension does not bypass protected streams. If a page exposes a signed MP4 through `og:video`, that URL is preferred.

## Publishing assistant

Open **Publishing & Comment Assistant** from the popup or dashboard.

1. Enter a title, body, and tags. Drafts are saved locally in the browser.
2. Click **Compliance check**.
3. Click **Open publishing page and autofill**.
4. Upload your own images or videos on the official Xiaohongshu publishing page.
5. If the editor is not ready, click **Fill extension draft** in the assistant panel on the page.
6. Review the media, topics, commercial disclosure, and text, then click **Publish** yourself.

The extension only fills editor fields. It does not click the final publishing button. For sponsored, gifted, or incentivized content, verify the platform’s disclosure and reporting requirements first.

## Comment assistant

Comment templates cover specific thanks, experience additions, concrete questions, and replies to comments on your own posts. Replace every template placeholder with a real detail related to the current note.

After passing the checks, the extension opens the target note and fills the comment box. It does not send the comment automatically.

Default safeguards:

- At most 10 prepared comments per day
- At least 5 minutes between preparations
- Highly similar recent comments are rejected
- Off-platform contact details, group invitations, QR codes, earnings promises, engagement exchange, medical claims, and attacks are blocked

## Safety and compliance boundaries

This extension is designed for assisted writing and page filling, not unattended account operation:

- No unattended publishing or bulk comment distribution
- No automated likes, follows, private messages, or engagement exchange
- No WeChat, QR code, group number, or external-link promotion features
- No CAPTCHA, login, access-control, or platform-security bypasses
- No cookie export, proxy pools, stealth mode, or anti-detection features
- No fabricated personal experience, metrics, or universal claims

Only save and use content you are authorized to handle. You are responsible for following platform rules, copyright requirements, and applicable laws.

## Local data and permissions

Data is stored in `chrome.storage.local` and is not uploaded to a project server.

| Permission | Purpose |
| --- | --- |
| `storage` / `unlimitedStorage` | Store notes, drafts, archive jobs, and comment-assistant records |
| `tabs` | Open search pages, detail pages, publishing pages, and comment targets |
| `alarms` | Control collection intervals and task progress |
| `downloads` | Save the single ZIP archive |
| Xiaohongshu and CDN host permissions | Read visible page content and accessible media |

The extension does not require a CLI, server, or paid API.

## Known limitations

- Xiaohongshu changes its page structure frequently; some experimental layouts may leave fields empty or prevent autofill.
- Search results are dynamic, so the same keyword and scroll count may not produce identical results.
- Videos require a directly accessible MP4 or other media URL; protected temporary streams are not bypassed.
- ZIP files are assembled in browser memory. For many large videos, process roughly five notes per batch.
- Downloaded content may be protected by copyright or platform rules; watermark removal is not provided.

## Development

This is a no-build Manifest V3 extension. After editing files, click **Reload** on the browser extensions page.

Basic syntax checks:

```powershell
node --check background.js
node --check content.js
node --check safety.js
node --check studio.js
```

## License

[MIT License](LICENSE)
