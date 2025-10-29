// src/service_worker.js
console.log("[LN] service worker loaded");

// --- Helpers ---
function polishAndClamp(s) {
  return (s || "").replace(/\s+/g, " ").trim().slice(0, 200);
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
  tone, profileSummary, name, userGuidance
}) {
  const focus = detectFocus(userGuidance);
  const companyLine = includeCompany && company
    ? companyInterestTemplate.replace("{{company}}", company)
    : "";

  const toneSystem = {
    neutral: [
      "Tone: warm, natural, human; light contractions welcome; avoid stiff corporate phrasing.",
      "Keep it approachable and confident; no emoji."
    ].join(" "),
    friendly: [
      "Tone: texting a friend; very casual; lower-case greeting; short and punchy; a little slang is fine; no emoji.",
      "Avoid formal punctuation; no em dashes; keep it breezy."
    ].join(" "),
    formal: [
      "Tone: very professional, as if emailing a professor; fully grammatical; polished; no slang; can be 1–2 sentences if needed.",
      "You may start with 'Dear {name},' or 'Hello {name},'."
    ].join(" ")
  }[tone] || "Tone: warm and natural.";

  const guidanceHardRule = userGuidance
    ? `User guidance (highest priority): "${userGuidance}". You MUST reflect this guidance explicitly in what detail you reference and how you phrase the note.`
    : "If no user guidance is given, pick the single most relevant detail.";

  const focusHints = {
    education: "Prefer education-related details (school, degree, program, lab).",
    activity:  "Prefer recent activity (post/announcement) if present.",
    experience:"Prefer a concrete experience bullet with action words or current role.",
    skills:    "Prefer a specific skill or stack item that relates to the interest.",
    auto:      "Choose the best single concrete detail."
  }[focus];

  const rules = [
    guidanceHardRule,
    focusHints,
    "First words must be a greeting like \"Hi {name},\" (use \"Hi there,\" if you don't have the name).",
    "Write in a warm, conversational voice; make it sound human and lightly personal, not robotic.",
    "Length: <=200 characters total.",
    "No emojis. No links. No phone/meeting ask.",
    `Include verbatim: "${identityLine}"`,
    "Reference exactly ONE concrete detail from the profile summary that fits the guidance.",
    "Avoid boilerplate like 'so I can learn more'. Vary closers or omit if forced.",
    "Do not imply the sender is an alumnus/alumna. The sender is a current undergraduate. If alumni context is relevant, phrase it as \"Boston College student reaching out to alumni\" or \"BC student\", never \"fellow alum\".",
    "If the company value is empty or appears to be a school, do NOT claim the sender is interning or working at that school. Prefer neutral phrasing like \"interested in your team\" or omit the employer phrase.",
    toneSystem
  ].join("\n");

  const system = [
    "You write LinkedIn connection notes for a student.",
    rules,
    companyLine ? `Interest line to include: "${companyLine}"` : ""
  ].filter(Boolean).join("\n");

  const user = JSON.stringify({
    targetName: name || "",
    company: company || "",
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

function toneShape(v, tone, name) {
  if (tone === "friendly") {
    let s = v.replace(/—/g, ",").trim();
    s = s.replace(/^hi\b/i, "hi");
    s = s.replace(/^hello\b/i, "hi");
    if (!/^hi\b/i.test(s)) {
      const who = (name || "there").trim();
      s = `hi ${who || "there"}, ${s}`;
    }
    s = s.replace(/\s{2,}/g, " ").trim();
    return s;
  }
  if (tone === "formal") {
    let s = v;
    if (!/^dear\b|^hello\b/i.test(s) && name) s = `Dear ${name}, ${s}`;
    s = s.replace(/\s{2,}/g, " ").trim();
    if (!/[.!?]$/.test(s)) s += ".";
    return s;
  }
  return v;
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

function ensureGreeting(text, name, tone) {
  let s = (text || "").trim();
  if (!s) return s;

  const target = (name || "").trim();
  const placeholder = target || "there";
  const toneWord = tone === "formal" ? "Hello" : "Hi";
  const friendlyWord = tone === "friendly" ? "hi" : toneWord;

  const hasGreeting = /^(hi|hello|hey|dear)\b/i.test(s);
  if (hasGreeting) {
    if (target && !new RegExp(`\\b${target.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i").test(s.slice(0, 48))) {
      s = s.replace(/^(hi|hello|hey|dear)(\s*)([,\-–—:]?)/i, (_m, word, space, punct) => {
        const suffix = punct && punct.trim() ? punct : ",";
        const spacer = space || " ";
        return `${word}${spacer}${target}${suffix}`;
      });
    }
    // Ensure we have a comma after the greeting for readability.
    s = s.replace(/^(hi|hello|hey|dear)\s+([^,\s]+)(?![,\s])/i, (_m, word, who) => `${word} ${who},`);
    return s;
  }

  const remainder = s.replace(/^[,.;:!\-–—]+/, "").trim();
  const comma = ",";
  const greeting = `${friendlyWord} ${placeholder}${comma}`;
  if (!remainder) return greeting;
  return `${greeting} ${remainder}`;
}

function formatVariants(candidates, focus, profileSummary, tone, name) {
  let out = (candidates || []).filter(Boolean);
  if (!out.length) return [];
  out = preferByGuidance(out, focus, profileSummary);
  return out.map(v => {
    const shaped = toneShape(v, tone, name);
    const fixed = fixSchoolAsEmployer(fixAlumniClaims(shaped));
    const greeted = ensureGreeting(fixed, name, tone);
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

function templateNote({ name, identityLine, company, includeCompany, companyInterestTemplate, profileSummary }) {
  const detail = pickDetailFromSummary(profileSummary);
  const companyLine = includeCompany && company
    ? companyInterestTemplate.replace("{{company}}", company)
    : "";

  const pieces = [
    `Hi ${name || "there"},`,
    identityLine,
    companyLine,
    detail ? `Loved your ${detail}.` : "",
    "Happy to connect."
  ].filter(Boolean);

  const base = pieces.join(" ");
  return polishAndClamp(base);
}

// --- simple rate limit ---
let lastCall = 0;

const BAN_PHRASES = [
  "so I can learn more",            // exact boilerplate
  "so I can learn more.",           // with period
  "so I can learn more about",      // variants
  "I'd love to connect and",
  "I would love to connect and",
  "connect so I can"                // awkward combo
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
  out = out.replace(/\s{2,}/g, " ").replace(/\s+([,.;!?])/g, "$1").trim();
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

    const payload = msg.payload || {};
    const { name, company, profileSummary, toneOverride } = payload;
    let userGuidance = payload.userGuidance || "";
    if (userGuidance) {
      userGuidance = userGuidance.replace(/\bbc\s+alum(nus|na|ni)?\b/gi, "BC alumni connection (sender is a current BC student)");
    }
    const toneActive = toneOverride || tone;
    const focus = detectFocus(userGuidance);
    console.log("[LN] payload:", { toneOverride, userGuidance, company, name });

    const { system, user } = buildMessages({
      identityLine,
      company,
      includeCompany,
      companyInterestTemplate,
      tone: toneActive,   // prefer override if set
      profileSummary,
      name,
      userGuidance
    });

    const fallbackTemplate = templateNote({ name, identityLine, company, includeCompany, companyInterestTemplate, profileSummary });

    if (!apiKey) {
      console.error("[LN] missing API key");
      const fallbackVariants = formatVariants([fallbackTemplate], focus, profileSummary, toneActive, name);
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
          variants: formatVariants([fallbackTemplate], focus, profileSummary, toneActive, name)
        };

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
      const candidates = raw.length
        ? raw.map(polishAndClamp)
        : [ fallbackTemplate ];
      const variants = formatVariants(candidates, focus, profileSummary, toneActive, name);
      console.log("[LN] guidance focus:", focus, variants);

      sendResponse({ variants });
    } catch (err) {
      console.error("[LN] fetch failed", err);
      sendResponse({
        error: "LLM_ERROR",
        detail: String(err),
        variants: formatVariants([fallbackTemplate], focus, profileSummary, toneActive, name)
      });
    }
  })();
  return true;
});
