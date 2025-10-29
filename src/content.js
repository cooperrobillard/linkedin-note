const PROFILE_PATH_RE = /^\/in\/[^/]+\/?$/i;
const PROFILE_URL_RE = /^https:\/\/(www\.)?linkedin\.com\/in\//i;

const SHOULD_RUN =
  window.top === window &&
  PROFILE_URL_RE.test(location.href) &&
  PROFILE_PATH_RE.test(location.pathname);

if (!SHOULD_RUN) {
  const reason = window.top !== window
    ? "iframe"
    : !PROFILE_URL_RE.test(location.href)
      ? "non-profile"
      : "subpath";
  console.debug("[LN] skip:", reason, location.href);
} else {
  (function main() {
    let booting = false;
    let bootedPath = "";
    let lastSkipPath = "";

    async function initLinkedInNote() {
      if (document.getElementById("cooper-note-chip")) return;
      console.log("[LN] boot", location.href);

      const chip = document.createElement("div");
      chip.id = "cooper-note-chip";
      chip.textContent = "Note";
      Object.assign(chip.style, {
        position: "fixed",
        right: "16px",
        bottom: "16px",
        zIndex: "2147483647",
        background: "#0a66c2",
        color: "#fff",
        borderRadius: "999px",
        padding: "8px 12px",
        font: "500 13px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial",
        cursor: "pointer",
        boxShadow: "0 2px 8px rgba(0,0,0,.15)"
      });
      document.body.appendChild(chip);

      const panel = document.createElement("div");
      panel.id = "cooper-note-panel";
      panel.style.cssText = `
        position: fixed; right: 16px; bottom: 56px; width: 380px; max-width: calc(100vw - 32px);
        background:#fff; color:#111; border:1px solid #e5e7eb; border-radius:12px; padding:12px;
        box-shadow:0 12px 28px rgba(0,0,0,.18); z-index:2147483647; display:none;
      `;
      panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <strong>Connection note</strong>
          <button class="cooper-btn" id="cooper-close" style="border:1px solid #d1d5db;border-radius:8px;padding:4px 8px;background:#fff;cursor:pointer">×</button>
        </div>

        <div style="display:flex; gap:6px; margin-bottom:8px;">
          <button class="cooper-btn" id="tone-friendly" style="border:1px solid #d1d5db;border-radius:8px;padding:4px 8px;background:#fff;cursor:pointer">Friendly</button>
          <button class="cooper-btn" id="tone-neutral"  style="border:1px solid #d1d5db;border-radius:8px;padding:4px 8px;background:#fff;cursor:pointer">Neutral</button>
          <button class="cooper-btn" id="tone-formal"   style="border:1px solid #d1d5db;border-radius:8px;padding:4px 8px;background:#fff;cursor:pointer">Formal</button>
        </div>

        <div id="cooper-detail" style="font-size:12px;color:#6b7280;margin-bottom:6px;">Using: (none)</div>

        <label style="display:block; font-size:12px; color:#6b7280; margin:8px 0 4px;">
          Optional guidance (persists): e.g., “BC alumni connection” or “congrats on awards if present”
        </label>
        <input id="cooper-guidance" type="text" placeholder="Any extra instructions you want the note to follow…" style="width:100%; padding:8px; border:1px solid #d1d5db; border-radius:8px; margin-bottom:8px;">

        <textarea id="cooper-draft" placeholder="Draft will appear here..." style="width:100%;min-height:100px;resize:vertical;border:1px solid #d1d5db;border-radius:8px;padding:8px;font:13px/1.4 system-ui"></textarea>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
          <div id="cooper-count" style="font-size:12px;color:#6b7280;">0 / 200</div>
          <div id="cooper-note-actions" style="display:flex; gap:6px; flex-wrap:wrap;">
            <button class="cooper-btn" id="cooper-generate" style="border:1px solid #d1d5db;border-radius:8px;padding:6px 10px;background:#fff;cursor:pointer">Generate</button>
            <button class="cooper-btn primary" id="cooper-copy" style="border:1px solid #0a66c2;border-radius:8px;padding:6px 10px;background:#0a66c2;color:#fff;cursor:pointer">Copy</button>
          </div>
        </div>
      `;
      document.body.appendChild(panel);

      const draftEl     = panel.querySelector("#cooper-draft");
      const countEl     = panel.querySelector("#cooper-count");
      const detailEl    = panel.querySelector("#cooper-detail");
      const closeBtn    = panel.querySelector("#cooper-close");
      const genBtn      = panel.querySelector("#cooper-generate");
      const copyBtn     = panel.querySelector("#cooper-copy");
      const btnFriendly = panel.querySelector("#tone-friendly");
      const btnNeutral  = panel.querySelector("#tone-neutral");
      const btnFormal   = panel.querySelector("#tone-formal");
      const guidanceEl  = panel.querySelector("#cooper-guidance");

      chrome.storage.sync.get({ userGuidance: "" }, ({ userGuidance }) => {
        guidanceEl.value = userGuidance || "";
      });

      let gTimer = null;
      guidanceEl.addEventListener("input", () => {
        clearTimeout(gTimer);
        gTimer = setTimeout(() => {
          chrome.storage.sync.set({ userGuidance: guidanceEl.value.trim() });
        }, 300);
      });

      let variants = [];
      let idx = 0;
      let busy = false;
      let pending = false;
      let toneOverride = null;

      const updateCount = () => {
        const len = draftEl.value.trim().length;
        const indicator = variants.length > 1 ? `  •  [${idx + 1}/${variants.length}]` : "";
        countEl.textContent = `${len} / 200${indicator}`;
        countEl.style.color = len > 200 ? "#dc2626" : "#6b7280";
      };

      function showVariant(i) {
        if (!variants.length) return;
        idx = (i + variants.length) % variants.length;
        draftEl.value = variants[idx];
        updateCount();
      }

      function setTone(t) {
        toneOverride = t;
        chrome.storage.sync.set({ lastTone: t });
        [btnFriendly, btnNeutral, btnFormal].forEach(b => b?.classList.remove("is-active"));
        const map = { friendly: btnFriendly, neutral: btnNeutral, formal: btnFormal };
        map[t]?.classList.add("is-active");
      }

      async function copyTextToClipboard(text, onDone) {
        try {
          await navigator.clipboard.writeText(text);
          onDone?.(true);
        } catch {
          try {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
            onDone?.(true);
          } catch (e2) {
            onDone?.(false, e2);
          }
        }
      }

      const setDetailHint = (detail) => {
        detailEl.textContent = detail ? `Using detail: "${detail}"` : "Using detail: (none)";
      };

      async function doGenerate() {
        if (busy) {
          pending = true;
          return;
        }
      busy = true;
      try {
        await new Promise(res => setTimeout(res, 500));
        const x = await window.extractProfileSmart();
        const profileSummary = window.buildProfileSummary ? window.buildProfileSummary(x) : "";
        const companyName = x.company || x.school || "your team";
        const firstName = window.extractFirstName ? window.extractFirstName(x.name) : ((x.name || "").split(/\s+/)[0] || "");

        if (!x.role && !x.company && !x.headline) {
          await new Promise(res => setTimeout(res, 800));
          try {
            const retry = await window.extractProfileSmart();
            if (retry && (retry.role || retry.company || retry.headline)) {
              Object.assign(x, retry);
            }
          } catch (retryErr) {
            console.warn("[LN] retry extract failed", retryErr);
          }
        }

        setDetailHint(x.detailHint || "");

        console.log("[LN][send]", {
          name: x.name,
          first: firstName,
            company: companyName,
            detailHint: x.detailHint,
            profileSummary: profileSummary.slice(0, 240)
          });

        const resp = await Promise.race([
          chrome.runtime.sendMessage({
            type: "GENERATE_NOTE_LLM",
            payload: {
              name: x.name || "",
              firstName,
              company: companyName,
              profileSummary,
              detailHint: x.detailHint || "",
              toneOverride,
              userGuidance: guidanceEl.value.trim()
            }
          }),
          new Promise(resolve => setTimeout(() => resolve({ error: "TIMEOUT" }), 15000))
        ]);

        if (resp?.error === "TIMEOUT") {
          variants = ["(timeout generating note)"];
        } else if (resp?.variants?.length) {
          variants = resp.variants;
        } else if (resp?.error) {
          variants = [`Error: ${resp.error}${resp.status ? " ("+resp.status+")" : ""}`];
        } else {
          variants = ["(no draft)"];
        }

          showVariant(0);
        } finally {
          busy = false;
          if (pending) {
            pending = false;
            setTimeout(() => doGenerate(), 0);
          }
        }
      }

      draftEl.addEventListener("input", updateCount);

      chip.addEventListener("click", () => {
        const opening = panel.style.display !== "block";
        panel.style.display = opening ? "block" : "none";
        if (opening && !variants.length && !busy) {
          doGenerate();
        }
        updateCount();
      });

      closeBtn.addEventListener("click", () => {
        panel.style.display = "none";
      });

      genBtn.addEventListener("click", () => doGenerate());

      copyBtn.addEventListener("click", async () => {
        const text = draftEl.value.trim();
        copyBtn.disabled = true;
        await copyTextToClipboard(text, (ok) => {
          copyBtn.textContent = ok ? "Copied!" : "Copy failed";
          setTimeout(() => {
            copyBtn.textContent = "Copy";
            copyBtn.disabled = false;
          }, 1200);
        });
      });

      btnFriendly?.addEventListener("click", () => { setTone("friendly"); doGenerate(); });
      btnNeutral ?.addEventListener("click", () => { setTone("neutral");  doGenerate(); });
      btnFormal  ?.addEventListener("click", () => { setTone("formal");   doGenerate(); });

      chrome.storage.sync.get({ lastTone: null }, ({ lastTone }) => {
        if (lastTone) setTone(lastTone);
      });

      window.__LN_note_doGenerate = doGenerate;
      window.__LN_note_setDetail = setDetailHint;
      await doGenerate();
    }

    function teardown() {
      document.getElementById("cooper-note-chip")?.remove();
      document.getElementById("cooper-note-panel")?.remove();
      delete window.__LN_note_doGenerate;
      delete window.__LN_note_setDetail;
    }

    async function initLinkedInNoteOnce() {
      if (booting) return;
      if (document.getElementById("cooper-note-chip")) {
        if (bootedPath !== location.pathname && typeof window.__LN_note_doGenerate === "function") {
          bootedPath = location.pathname;
          await window.__LN_note_doGenerate();
          return;
        }
        bootedPath = location.pathname;
        return;
      }
      booting = true;
      try {
        await initLinkedInNote();
        bootedPath = location.pathname;
      } catch (err) {
        console.error("[LN] init failed", err);
      } finally {
        booting = false;
      }
    }

    async function ensureForRoute() {
      if (!PROFILE_PATH_RE.test(location.pathname)) {
        if (document.getElementById("cooper-note-chip")) {
          teardown();
        }
        bootedPath = "";
        if (lastSkipPath !== location.pathname) {
          console.debug("[LN] skip subpath:", location.pathname);
          lastSkipPath = location.pathname;
        }
        return;
      }
      lastSkipPath = "";

      if (bootedPath === location.pathname && document.getElementById("cooper-note-chip")) {
        return;
      }

      await initLinkedInNoteOnce();
    }

    ensureForRoute();
    setInterval(ensureForRoute, 800);
  })();
}
