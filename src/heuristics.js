// src/heuristics.js

// Tiny helpers
function t(el) { return (el?.textContent || "").replace(/\s+/g, " ").trim(); }
function first(sel, root=document) { return root.querySelector(sel); }
function all(sel, root=document) { return Array.from(root.querySelectorAll(sel)); }
function topN(arr, n) { return (arr || []).filter(Boolean).slice(0, n); }
function dedupeWords(str) {
  if (!str) return "";
  const tokens = (str || "").split(/\s+/).filter(Boolean);
  if (!tokens.length) return "";

  const deduped = [];
  const normalized = (value) => value.replace(/^[^A-Za-z0-9&]+|[^A-Za-z0-9&]+$/g, "");

  for (const token of tokens) {
    const prev = deduped[deduped.length - 1];
    const prevNorm = prev ? normalized(prev).toLowerCase() : "";
    const currNorm = normalized(token).toLowerCase();

    if (!deduped.length || currNorm !== prevNorm) deduped.push(token);
  }

  let joined = deduped.join(" ").trim();
  if (!joined) return "";

  if (deduped.length === 1) {
    const sole = joined;
    const fused = sole.match(/^(.+?)\1+$/i);
    if (fused?.[1] && fused[1].length >= 3) joined = fused[1];
  }

  return joined;
}
function sanitizeCompany(s) {
  if (!s) return "";
  let out = s;

  const employmentPatterns = [
    /full[-\s]?time/gi,
    /part[-\s]?time/gi,
    /\bcontract\b/gi,
    /\binternship\b/gi,
    /\bapprenticeship\b/gi,
    /self[-\s]?employed/gi,
    /\bfreelance\b/gi
  ];
  employmentPatterns.forEach((re) => {
    out = out.replace(re, " ");
  });

  const durationPattern = /\b\d+\s*(?:years?|yrs?|months?|mos?|weeks?|wks?)\b(?:\s+\d+\s*(?:years?|yrs?|months?|mos?|weeks?|wks?))?/gi;
  out = out.replace(durationPattern, " ");

  out = out.replace(/\s*[•·|–—-]+\s*/g, " ");

  out = out.replace(/\s+/g, " ").trim();

  out = out.replace(/^[,•·|–—-]+/, "").replace(/[,•·|–—-]+$/, "").trim();

  out = dedupeWords(out);
  out = out.replace(/^[,•·|–—-]+/, "").replace(/[,•·|–—-]+$/, "").trim();

  return out;
}

// Find a section by heading text like "Experience", "Activity", "Education"
function findSection(regex) {
  // LinkedIn changes markup often; scan all sections and their first heading-like element
  const sections = all("section");
  for (const s of sections) {
    const head = s.querySelector("h2, h3, h4, div[role='heading']");
    const text = t(head || s);
    if (regex.test(text)) return s;
  }
  return null;
}

// Try to get current role/company from the first card in Experience
function extractExperience() {
  const exp = findSection(/experience/i);
  if (!exp) return { role: "", company: "", bullets: [] };

  const card = first("li, article, div.pvs-entity", exp) || exp;

  const role =
    t(first("span[aria-hidden='true']", card)) ||
    t(first("div[dir='ltr'] span", card));

  // Prefer company link, then small-text line; sanitize either way
  const companyLink = first("a[href*='/company/']", card);
  const companyRaw = companyLink
    ? t(companyLink)
    : (t(first("span.t-14.t-normal", card)) || t(first("span.t-14", card)));
  const company = sanitizeCompany(companyRaw);

  const bullets = all("li", card).map(el => t(el)).filter(Boolean).slice(0, 3);
  return { role, company, bullets };
}

// Headline near the name
function extractHeadline() {
  return (
    t(first(".text-body-medium.break-words")) ||
    t(first("[data-test-id='hero-title']")) ||
    ""
  );
}

// Education section (helps with “Student at {School}” cases)
function extractEducation() {
  const edu = findSection(/education/i);
  if (!edu) return { education: "", school: "", degree: "" };
  const text = t(edu);
  // Guess a school name from the first edu card/link
  const school =
    t(first("a[href*='/school/']", edu)) ||
    t(first("li div > span[aria-hidden='true']", edu)) ||
    "";
  const firstCard =
    first("li, article, div.pvs-entity", edu) ||
    first("div[data-test-education-card]", edu) ||
    null;

  let degree = "";
  if (firstCard) {
    const lines = all("span[aria-hidden='true']", firstCard).map(t).filter(Boolean);
    const info = lines.filter(line => !school || line.toLowerCase() !== school.toLowerCase());
    if (info.length) {
      degree = info.slice(0, 2).join(" • ").trim();
    }
  }

  return { education: text, school, degree };
}

// Recent activity snippet (launches, posts, etc.)
function extractActivity() {
  const act = findSection(/activity/i);
  if (!act) return [];
  const nodes = all("a, p, span", act).map(n => t(n)).filter(Boolean);
  return topN(nodes, 2).map(s => s.slice(0, 160));
}

// Headline parse helper: try to pull “role at company”
function parseHeadline(headline) {
  // e.g. "Computer Science Student at Indiana University"
  const m = headline.match(/(.+?)\s+at\s+(.+)/i);
  if (m) return { roleFromHeadline: m[1].trim(), companyFromHeadline: m[2].trim() };
  return { roleFromHeadline: "", companyFromHeadline: "" };
}

// Main: extract profile fields we care about
function extractProfileSmart() {
  const name = t(first("h1")) || "";
  const headline = extractHeadline();
  const { role, company, bullets } = extractExperience();
  const { roleFromHeadline, companyFromHeadline } = parseHeadline(headline);
  const activityArr = extractActivity();
  const { education, school, degree } = extractEducation();
  const skills = all("span.pvs-entity__skill-category-name, span[data-test-id='skill']")
    .slice(0, 5).map(el => t(el));

  const companyBest = sanitizeCompany(company) || sanitizeCompany(companyFromHeadline) || "";
  const roleBest = role || roleFromHeadline || "";

  console.log("[LN] extracted:", { name, role: roleBest, company: companyBest, bullets, activity: activityArr?.[0] });

  return {
    name, headline,
    role: roleBest, company: companyBest,
    bullets,              // array
    activityArr,          // array
    education, school, degree, skills
  };
}

// Pick ONE concrete detail for the note
function pickDetailSmart(x) {
  const c = (s) => (s || "").replace(/\s+/g, " ").trim();

  // 1) Role + Company if role is informative (avoid “Student” only if we have a program)
  if (x.role && x.company) {
    const roleShort = x.role.replace(/^(student|intern)\b/i, "").trim() || x.role;
    return c(`${roleShort} at ${x.company}`);
  }

  // 2) First experience bullet with action words/metrics
  if (x.firstBullet && /\b(launched|shipped|built|scaled|led|designed|deployed|evaluat|red-?team|on-?device|inference|LLM|research|published)\b/i.test(x.firstBullet)) {
    return c(x.firstBullet);
  }

  // 3) Activity snippet (recent post)
  if (x.activity) return c(x.activity);

  // 4) Headline (e.g., “CS Student at IU”)
  if (x.headline) return c(x.headline);

  // 5) School as last resort (“Computer Science @ Indiana University” if we have both)
  if (x.school && x.role) return c(`${x.role} @ ${x.school}`);
  if (x.school) return c(x.school);

  // 6) Skill fallback
  if (x.skills?.length) return c(x.skills[0]);

  return "";
}
// Build a compact "full text" of the visible profile for the LLM (<= ~1200 chars)
function buildProfileSummary(x) {
  const parts = [];
  if (x.name) parts.push(`Name: ${x.name}`);
  if (x.headline) parts.push(`Headline: ${x.headline}`);
  if (x.role) parts.push(`Role: ${x.role}`);
  if (x.company) parts.push(`Company: ${x.company}`);
  if (x.school) parts.push(`School: ${x.school}`);
  if (x.degree) parts.push(`Degree: ${x.degree}`);

  if (x.bullets?.length) {
    x.bullets.forEach((b, i) => parts.push(`Experience bullet ${i+1}: ${b}`));
  }
  if (x.activityArr?.length) {
    x.activityArr.forEach((a, i) => parts.push(`Recent activity ${i+1}: ${a}`));
  }
  if (x.skills?.length) parts.push(`Skills: ${x.skills.join(", ")}`);

  const text = parts.join(" | ").replace(/\s+/g, " ").trim();
  return text.slice(0, 1500); // slightly larger now
}

function educationSnippet(x = {}) {
  const degree = (x.degree || "").trim();
  const school = (x.school || "").trim();
  if (degree && school) return `${degree} @ ${school}`.trim();
  if (school) return school;
  return (x.education || "").slice(0, 120).trim();
}

// expose helpers to content.js
if (typeof window !== "undefined") {
  window.extractProfileSmart = extractProfileSmart;
  window.pickDetailSmart = pickDetailSmart;
  window.buildProfileSummary = buildProfileSummary;
  window.educationSnippet = educationSnippet;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { sanitizeCompany, extractExperience, dedupeWords, educationSnippet, extractEducation };
}
