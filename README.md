# LinkedIn Note — AI-Assisted Connection Notes (Chrome Extension)

A **Manifest V3** Chrome extension that reads visible data from a LinkedIn profile and generates concise, context-aware connection notes directly in-tab using the OpenAI API. Designed for speed, privacy, and simplicity — everything runs client-side with no external database or automation.

---

## Features

* **In-tab UI:** Floating “Note” panel on LinkedIn profile pages with `Generate`, `Copy`, and tone options.
* **DOM Extraction:** Parses visible profile sections (headline, experience, education, skills, recent activity).
* **AI Integration:** Calls an OpenAI-compatible endpoint (e.g., `gpt-4o-mini`) through a background service worker.
* **Guidance Input:** Users can provide persistent custom instructions (“Focus on BC alumni,” “Mention awards,” etc.).
* **Tone Control:** Friendly / Neutral / Formal modes for stylistic variation.
* **Privacy-first:** No bulk scraping, automation, or server storage — all data handled locally.
* **Offline / Quota Fallback:** Local template generation if API call fails or quota is exceeded.
* **Clipboard Support:** One-click copy with fallback for restricted clipboard environments.

---

## Architecture Overview

```
manifest.json
├── src/
│   ├── content.js          ← injects panel + extracts DOM fields
│   ├── heuristics.js       ← parsing and prioritization logic
│   ├── service_worker.js   ← API communication, prompt building, post-processing
│   └── inject.css          ← panel styling
├── options/
│   ├── options.html
│   └── options.js          ← API key/model/identity/tone/guidance persistence
├── popup/
│   └── popup.html          ← simple launcher
└── README.md
```

### **Data Flow**

1. User opens a LinkedIn profile.
2. `content.js` extracts relevant info and injects the floating panel.
3. Clicking **Generate** sends extracted data + user guidance to the service worker.
4. Service worker builds a compact JSON payload → OpenAI API → returns 1–3 drafts.
5. Drafts are shown inline; user can cycle tone or regenerate.
6. **Copy** button writes the chosen draft to clipboard.

---

## Installation (Developer Mode)

1. Clone or download this repository:

   ```bash
   git clone https://github.com/<your-username>/linkedin-note.git
   ```
2. Open Chrome → `chrome://extensions`
3. Toggle **Developer Mode** (top right)
4. Click **Load Unpacked** → select the `linkedin-note` folder
5. Open a LinkedIn profile → click the **Note** chip to start generating

---

## Configuration

1. Click the extension icon → **Options**
2. Enter:

   * **API Base:** `https://api.openai.com/v1`
   * **Model:** `gpt-4o-mini` (or another compatible model)
   * **API Key:** (keep private — stored locally via `chrome.storage`)
   * **Identity line:** e.g. “I'm Cooper, Boston College ’27, Human-Centered Engineering.”
   * **Company interest template:** “Strong interest in {{company}}.”
3. Adjust tone and company interest preferences as desired.

---

## Prompt Structure

Each request sends a minimal JSON payload like:

```json
{
  "name": "Alex",
  "company": "OpenAI",
  "headline": "Product Manager, Applied Research",
  "detail": "red-teaming multimodal models",
  "guidance": "Highlight BC alumni connection if relevant"
}
```

### **System Prompt Highlights**

* Output ≤ 200 characters
* No emojis, no calls-to-action
* Include identity line verbatim
* Reference exactly one concrete profile detail
* Natural tone (no forced closing phrases)

---

## Tech Stack

* Chrome Manifest V3
* JavaScript (ES6)
* DOM APIs / MutationObserver
* OpenAI API (Chat Completions)
* `chrome.storage.sync`
* Clipboard API
* HTML + CSS (Shadow DOM-safe styling)

---

## Compliance & Privacy

* Operates only on user-opened pages
* Reads visible content only
* No automation of clicks, invites, or bulk actions
* No remote database — everything stays local
* API key and settings stored via `chrome.storage.sync`

---

## Development Notes

* Works best on `/in/` profile URLs.
* If the panel doesn’t appear after navigating within LinkedIn (SPA routing), reload the page.
* Use `chrome://extensions → Inspect views (service worker)` for logs (`[LN]` prefix).
* Ensure billing is attached to your OpenAI key to avoid 429 (insufficient_quota) errors.
