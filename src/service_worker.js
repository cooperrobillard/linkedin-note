// src/service_worker.js
console.log("[LN] service worker loaded");

// --- Helpers ---
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
  tone, profileSummary, name, firstName, userGuidance, detailHint, informalityLevel = 7
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
    "Reference EXACTLY ONE concrete detail from the profile summary.",
    toneLine,
    `Body informality target (1=formal, 10=casual): ${informalityLevel}/10. Write a single sentence body that feels natural at this level, with correct grammar and punctuation.`,
    `Identity line: ${identityLine}. Do NOT repeat or paraphrase it.`,
    userGuidance ? `User guidance (must consider): ${userGuidance}` : "",
    detailHint ? `Detail hint (prefer referencing this): ${detailHint}` : "",
    companyLine ? `Company interest line to weave in if natural: ${companyLine}` : ""
  ].filter(Boolean).join("\n");

  const user = JSON.stringify({
    targetName: name || "",
    firstName: firstName || "",
    company: company || "",
    includeLine: companyLine,
    profileSummary,
    identityLine,
    informalityLevel
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

function formatVariants(candidates, focus, profileSummary, informalityLevel, firstName, name, identityLine) {
  let out = (candidates || []).filter(Boolean);
  if (!out.length) return [];
  out = preferByGuidance(out, focus, profileSummary);
  return out.map(v => {
    let body = stripLeadingGreeting(v);
    body = stripIdentityLine(body, identityLine);
    body = dedupePhrases(fixSchoolAsEmployer(fixAlumniClaims(body)));
    return canonicalizeNote({ firstName, name, identityLine, body, informalityLevel });
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

function templateBody({ company, includeCompany, companyInterestTemplate, profileSummary, detailHint }) {
  const detail = (detailHint || pickDetailFromSummary(profileSummary) || "").replace(/\s+/g, " ").trim();
  const companyLine = includeCompany && company
    ? companyInterestTemplate.replace("{{company}}", company).replace(/\.$/, "")
    : "";

  const detailLine = detail
    ? `Your ${detail.replace(/^your\s+/i, "").replace(/\.$/, "")} stood out`
    : "";

  return [companyLine, detailLine].filter(Boolean).join(" — ").trim() || "Good to connect";
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
  out = out.replace(/[\s,–—-]+$/g, "").trim();
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

function stripLeadingGreeting(s) {
  return (s || "").replace(/^\s*(hi|hello|hey)\s+[^,]*,?\s*/i, "").trim();
}

function stripIdentityLine(s, identityLine) {
  let out = s || "";
  if (!out) return out;

  if (identityLine) {
    const esc = identityLine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp("\\b" + esc + "\\b\\.?\\s*", "i"), "").trim();
  }

  const selfIntroRe = /\b(i\s*(?:'|’)?m|i\s+am)\s+cooper\b[^.?!]*\b(boston\s+college|bc)\b[^.?!]*[.?!]?\s*/i;
  out = out.replace(selfIntroRe, "").trim();

  const firstSentenceRe = /^\s*(i\s*(?:'|’)?m|i\s+am)\s+cooper\b[^.?!]*[.?!]\s*/i;
  out = out.replace(firstSentenceRe, "").trim();

  return out;
}

function firstSentenceOnly(s) {
  const text = String(s || "");
  const match = text.match(/^[\s\S]*?[.?!](?=\s|$)/);
  return (match ? match[0] : text).trim();
}

function sentenceClean(s) {
  let out = (s || "").replace(/\s{2,}/g, " ").replace(/\s+([,.;!?])/g, "$1").trim();
  if (out && !/[.?!]$/.test(out)) out += ".";
  return out;
}

function pickClosing(level=7) {
  const n = Math.max(1, Math.min(10, Math.round(level)));
  let arr;
  if (n <= 3) {
    arr = [
      "I would value the connection.",
      "I appreciate your time.",
      "I look forward to connecting."
    ];
  } else if (n <= 6) {
    arr = [
      "Looking forward to connecting.",
      "Would love to learn more.",
      "Appreciate your time."
    ];
  } else if (n <= 8) {
    arr = [
      "Looking forward to connecting soon.",
      "Would love to swap stories.",
      "Hope we can chat soon."
    ];
  } else {
    arr = [
      "Can't wait to connect.",
      "Hope to learn more soon.",
      "Catch you soon."
    ];
  }
  const choice = arr[Math.floor(Math.random() * arr.length)] || "Looking forward to connecting.";
  return choice.replace(/[.]*$/, "").trim() + ".";
}

function canonicalizeNote({ firstName, name, identityLine, body, informalityLevel }) {
  const greet = (firstName || name || "there").trim() || "there";
  const greeting = `Hi ${greet},`;
  const id = identityLine ? `${identityLine.replace(/[.]\s*$/, "")}.` : "";
  const bodySentence = sentenceClean(firstSentenceOnly(body));
  const closing = pickClosing(informalityLevel);

  let out = [greeting, id, bodySentence, closing].filter(Boolean).join(" ");
  out = dedupePhrases(out);
  out = polishAndClamp(out).trim();
  out = out.replace(/[!?]+$/, "").trim();
  if (!/[.]$/.test(out)) out += ".";
  return out;
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

    const { name, firstName, company, profileSummary, detailHint, informalityLevel: informalityRaw, userGuidance } = msg.payload || {};
    const informalityLevel = Number(informalityRaw) || 7;
    let guidance = userGuidance || "";
    if (guidance) {
      guidance = guidance.replace(/\bbc\s+alum(nus|na|ni)?\b/gi, "BC alumni connection (sender is a current BC student)");
    }
    const toneActive = tone;
    const focus = detectFocus(guidance);
    const nameForGreeting = (firstName || name || "").trim();
    console.log("[LN][recv]", {
      name,
      firstName: nameForGreeting,
      company,
      detailHint,
      guidance: guidance ? guidance.slice(0, 120) : "",
      informalityLevel
    });

    const { system, user } = buildMessages({
      identityLine,
      company,
      includeCompany,
      companyInterestTemplate,
      tone: toneActive,
      profileSummary,
      name,
      firstName: nameForGreeting,
      userGuidance: guidance,
      detailHint,
      informalityLevel
    });

    console.log("[LN][prompt]", {
      system: system.slice(0, 240),
      user: user.slice(0, 240)
    });

    const fallbackBody = templateBody({ company, includeCompany, companyInterestTemplate, profileSummary, detailHint });

    if (!apiKey) {
      console.error("[LN] missing API key");
      const fallbackVariants = formatVariants([fallbackBody], focus, profileSummary, informalityLevel, nameForGreeting, name, identityLine);
      console.log("[LN][raw]", []);
      console.log("[LN][variants]", fallbackVariants);
      sendResponse({ error: "NO_API_KEY", fallback: fallbackVariants[0] || canonicalizeNote({ firstName: nameForGreeting, name, identityLine, body: fallbackBody, tone: toneActive }) });
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
          variants: formatVariants([fallbackBody], focus, profileSummary, informalityLevel, nameForGreeting, name, identityLine)
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
        : [ fallbackBody ];
      const variants = formatVariants(candidates, focus, profileSummary, informalityLevel, nameForGreeting, name, identityLine);
      console.log("[LN] guidance focus:", focus, variants);
      console.log("[LN][variants]", variants);

      sendResponse({ variants });
    } catch (err) {
      console.error("[LN] fetch failed", err);
      const fallbackVariants = formatVariants([fallbackBody], focus, profileSummary, informalityLevel, nameForGreeting, name, identityLine);
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
