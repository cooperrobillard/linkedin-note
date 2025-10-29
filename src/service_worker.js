// src/service_worker.js
console.log("[LN] service worker loaded");

// --- Helpers ---

function ensureGreeting(text, firstName, fallbackName) {
  const first = (firstName || fallbackName || "").trim() || "there";
  let out = String(text || "");
  out = out.replace(/^\s*(hi|hello)\s+[^,]*,?\s*/i, "");
  out = out.replace(/^[\s,–—-]+/, "").trim();
  if (!out) out = "Good to connect.";
  const cap = out.charAt(0).toUpperCase() + out.slice(1);
  return `Hi ${first}, ${cap}`.trim();
}
function detectFocus(userGuidance="") {
  const g = (userGuidance || "").toLowerCase();
  if (/educat|school|university|college|degree|alum/i.test(g)) return "education";
  if (/activit|post|recent|announcement/i.test(g)) return "activity";
  if (/experien|project|bullet|launched|shipped|built|role\b/i.test(g)) return "experience";
  if (/skill|stack|tech|tools?/i.test(g)) return "skills";
  return "auto";
}

function buildMessages({
  identityLine, company, includeCompany, companyInterestTemplate,
  tone, profileSummary, name, firstName, userGuidance, detailHint
}) {
  const toneLine = ({
    friendly: "Tone: friendly, conversational, use contractions.",
    neutral: "Tone: clear, natural, use contractions.",
    formal: "Tone: concise and professional (still warm)."
  })[tone] || "Tone: clear, natural, use contractions.";

  const companyLine = includeCompany && company
    ? companyInterestTemplate.replace("{{company}}", company)
    : "";

  const system = [
    "You write short LinkedIn connection notes for a student.",
    "One sentence, 120–200 characters.",
    "No emojis, no links, no meeting ask.",
    `Include verbatim identity line: "${identityLine}"`,
    "Reference EXACTLY ONE concrete detail from the profile summary.",
    "Open with a personal greeting: “Hi {name}, …”. Use firstName if provided.",
    "Avoid templated closers; vary or omit if forced.",
    toneLine,
    userGuidance ? `User guidance (must consider): ${userGuidance}` : "",
    detailHint ? `Detail hint (prefer referencing this): ${detailHint}` : "",
    companyLine ? `Company interest line to weave in if natural: ${companyLine}` : ""
  ].filter(Boolean).join("\n");

  const user = JSON.stringify({
    targetName: name || "",
    firstName: firstName || "",
    company: company || "",
    includeLine: companyLine,
    profileSummary
  });

  return { system, user };
}

function preferByGuidance(variants, focus, profileSummary) {
  if (!variants?.length) return variants || [];
  const sum = (profileSummary || "").toLowerCase();
  const tokens = {
    education: (sum.match(/school:\s*([^|]+)/i)?.[1] || "") + " " + (sum.match(/degree:\s*([^|]+)/i)?.[1] || ""),
    activity:  (sum.match(/recent activity[^:]*:\s*([^|]+)/i)?.[1] || ""),
    experience:(sum.match(/experience bullet[^:]*:\s*([^|]+)/i)?.[1] || "") + " " + (sum.match(/role:\s*([^|]+)/i)?.[1] || ""),
    skills:    (sum.match(/skills:\s*([^|]+)/i)?.[1] || "")
  }[focus] || "";

  if (!tokens.trim()) return variants;

  const kw = tokens.toLowerCase().split(/[,\s]+/).filter(s => s.length > 2).slice(0, 6);
  const score = (v) => {
    const lc = v.toLowerCase();
    return kw.reduce((acc, w) => acc + (lc.includes(w) ? 1 : 0), 0);
  };

  return [...variants].sort((a,b) => score(b) - score(a));
}

function fixAlumniClaims(s) {
  let out = s || "";
  out = out.replace(/\bfellow\s+([A-Za-z.&\s]+?)\s+alum(nus|na|ni)?\b/gi, "BC student reaching out to alumni");
  out = out.replace(/\bas\s+(an?\s+)?alum(nus|na|ni)?\b/gi, "as a BC student");
  out = out.replace(/\balum(nus|na|ni)?\s+of\b/gi, "student at");
  return out;
}

function fixSchoolAsEmployer(s) {
  let out = s || "";
  out = out.replace(/\b(intern(?:ing)?|work(?:ing)?)\s+at\s+[A-Za-z0-9&.,'()\s-]*(?:University|College|School|Institute|Academy)\b([,.;!?])?/gi,
    (match, verb, punct = "") => {
      const lower = verb.toLowerCase();
      let replacement = lower.startsWith("intern") ? "interning with your team" : "working with your team";
      if (/^[A-Z]/.test(verb)) {
        replacement = replacement.charAt(0).toUpperCase() + replacement.slice(1);
      }
      return `${replacement}${punct || ""}`;
    });
  out = out.replace(/\bstrong interest in\s+[A-Za-z0-9&.,'()\s-]*(?:University|College|School|Institute|Academy)\b/gi,
    (match) => (/^[A-Z]/.test(match) ? "Strong interest in your team" : "strong interest in your team"));
  return out;
}

function formatVariants(candidates, focus, profileSummary, tone, firstName, name) {
  let out = (candidates || []).filter(Boolean);
  if (!out.length) return [];
  out = preferByGuidance(out, focus, profileSummary);
  return out.map(v => {
    const fixed = fixSchoolAsEmployer(fixAlumniClaims(v));
    const polished = polishAndClamp(fixed);
    const greeted = ensureGreeting(polished, firstName, name);
    return polishAndClamp(greeted);
  });
}

// crude “detail” extractor from profileSummary as fallback
function pickDetailFromSummary(summary) {
  if (!summary) return "";
  // prefer Experience bullet, then Role@Company patterns, then Activity
  const exp = summary.match(/Experience bullet:\s*([^|]+)/i);
  if (exp) return exp[1].trim();
  const roleAt = summary.match(/Role:\s*([^|]+).*Company:\s*([^|]+)/i);
  if (roleAt) return `${roleAt[1].trim()} at ${roleAt[2].trim()}`;
  const act = summary.match(/Recent activity:\s*([^|]+)/i);
  if (act) return act[1].trim();
  const head = summary.match(/Headline:\s*([^|]+)/i);
  if (head) return head[1].trim();
  return "";
}

function templateNote({ name, firstName, identityLine, company, includeCompany, companyInterestTemplate, profileSummary, detailHint, tone }) {
  const detail = (detailHint || pickDetailFromSummary(profileSummary) || "").replace(/\s+/g, " ").trim();
  const companyLine = includeCompany && company
    ? companyInterestTemplate.replace("{{company}}", company)
    : "";

  const detailLine = detail
    ? `Your ${detail.replace(/^your\s+/i, "").replace(/\.$/, "")} stood out—`
    : "";

  const coreParts = [
    identityLine,
    companyLine,
    detailLine,
    "keen to connect."
  ].filter(Boolean);

  const core = coreParts.join(" ").replace(/\s{2,}/g, " ").trim();
  const polished = polishAndClamp(core);
  return ensureGreeting(polished, firstName, name);
}

// --- simple rate limit ---
let lastCall = 0;

const BAN_PHRASES = [
  "so I can learn more",
  "so I can learn more.",
  "so I can learn more about",
  "i'd love to connect and",
  "i would love to connect and",
  "i’d love to connect and",
  "would love to connect and",
  "i'd love to connect",
  "i’d love to connect",
  "connect so I can"
];

function dedupePhrases(s) {
  // Remove repeated “connect” phrasing like “connect … connect”
  let out = s.replace(/\b(connect)\b.*\b\1\b/gi, "$1");
  // Remove banned phrases
  BAN_PHRASES.forEach(p => {
    const re = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    out = out.replace(re, "");
  });
  // Clean leftover double spaces / stray punctuation
  out = out.replace(/\s{2,}/g, " ");
  out = out.replace(/\s+([,.;!?])/g, "$1");
  out = out.replace(/[\s,.–—-]+$/g, "").trim();
  // Merge double hyphen artifacts
  out = out.replace(/—\s*—/g, "—");
  return out;
}

function polishAndClamp(str) {
  const s = dedupePhrases((str || "").replace(/\s+/g, " ").trim());
  if (s.length <= 200) return s;
  // Keep full text visible for manual editing; rely on count indicator for >200 chars
  return s;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type !== "GENERATE_NOTE_LLM") return;

const WINDOW_MS = 800;
const now = Date.now();
const wait = Math.max(0, WINDOW_MS - (now - lastCall));
if (wait > 0) await new Promise(r => setTimeout(r, wait));
lastCall = Date.now();


    const defaults = {
      apiKey: "",
      apiBase: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      identityLine: "I'm Cooper, Boston College ’27, Human-Centered Engineering.",
      companyInterestTemplate: "Strong interest in {{company}}.",
      tone: "neutral",
      includeCompany: true
    };
    const cfg = await chrome.storage.sync.get(defaults);
    const { apiKey, apiBase, model, identityLine, companyInterestTemplate, tone, includeCompany } = cfg;

    const { name, firstName, company, profileSummary, detailHint, toneOverride, userGuidance } = msg.payload || {};
    let guidance = userGuidance || "";
    if (guidance) {
      guidance = guidance.replace(/\bbc\s+alum(nus|na|ni)?\b/gi, "BC alumni connection (sender is a current BC student)");
    }
    const toneActive = toneOverride || tone;
    const focus = detectFocus(guidance);
    const nameForGreeting = (firstName || name || "").trim();
    console.log("[LN][recv]", {
      name,
      firstName: nameForGreeting,
      company,
      detailHint,
      guidance: guidance ? guidance.slice(0, 120) : "",
      toneOverride
    });

    const { system, user } = buildMessages({
      identityLine,
      company,
      includeCompany,
      companyInterestTemplate,
      tone: toneActive,   // prefer override if set
      profileSummary,
      name,
      firstName: nameForGreeting,
      userGuidance: guidance,
      detailHint
    });

    console.log("[LN][prompt]", {
      system: system.slice(0, 240),
      user: user.slice(0, 240)
    });

    const fallbackTemplate = templateNote({ name, firstName: nameForGreeting, identityLine, company, includeCompany, companyInterestTemplate, profileSummary, detailHint, tone: toneActive });

    if (!apiKey) {
      console.error("[LN] missing API key");
      const fallbackVariants = formatVariants([fallbackTemplate], focus, profileSummary, toneActive, nameForGreeting, name);
      console.log("[LN][raw]", []);
      console.log("[LN][variants]", fallbackVariants);
      sendResponse({ error: "NO_API_KEY", fallback: fallbackVariants[0] || fallbackTemplate });
      return;
    }

    // tiny retry-on-429
    const url = `${apiBase.replace(/\/+$/,"")}/chat/completions`;
    async function callOnce() {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
body: JSON.stringify({
  model,
  messages: [
    { role: "system", content: system },
    { role: "user", content: user }
  ],
  n: 3,
temperature: 0.85,
top_p: 0.95,
presence_penalty: 0.3,
frequency_penalty: 0.3
})

      });
      return r;
    }

    try {
      let r = await callOnce();
      if (r.status === 429) {
        console.warn("[LN] 429 received; retrying once after backoff");
        await new Promise(res => setTimeout(res, 900));
        r = await callOnce();
      }

      if (!r.ok) {
        const text = await r.text().catch(() => "");
        let parsed = null;
        try { parsed = JSON.parse(text); } catch {}
        const status = r.status;
        const apiMsg = parsed?.error?.message || text || "";
        const apiCode = parsed?.error?.code || parsed?.error?.type || "";

        // Detect OpenAI "insufficient_quota"
        const isNoQuota = status === 429 && /insufficient_quota/i.test(apiMsg + " " + apiCode);

        const payload = {
          status,
          body: (apiMsg || "").slice(0, 500),
          variants: formatVariants([fallbackTemplate], focus, profileSummary, toneActive, nameForGreeting, name)
        };
        console.log("[LN][raw]", []);
        console.log("[LN][variants]", payload.variants);

        if (isNoQuota) {
          console.warn("[LN] OpenAI insufficient_quota (429)");
          sendResponse({ error: "INSUFFICIENT_QUOTA", ...payload });
          return;
        }

        console.error("[LN] HTTP error", status, (apiMsg || "").slice(0, 300));
        sendResponse({ error: "OPENAI_HTTP_ERROR", ...payload });
        return;
      }

      const data = await r.json();
      const raw = (data?.choices || []).map(c => c.message?.content || "").filter(Boolean);
      console.log("[LN][raw]", raw);
      const candidates = raw.length
        ? raw
        : [ fallbackTemplate ];
      const variants = formatVariants(candidates, focus, profileSummary, toneActive, nameForGreeting, name);
      console.log("[LN] guidance focus:", focus, variants);
      console.log("[LN][variants]", variants);

      sendResponse({ variants });
    } catch (err) {
      console.error("[LN] fetch failed", err);
      const fallbackVariants = formatVariants([fallbackTemplate], focus, profileSummary, toneActive, nameForGreeting, name);
      console.log("[LN][raw]", []);
      console.log("[LN][variants]", fallbackVariants);
      sendResponse({
        error: "LLM_ERROR",
        detail: String(err),
        variants: fallbackVariants
      });
    }
  })();
  return true;
});
