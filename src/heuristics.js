// src/heuristics.js

// ---------- tiny DOM helpers ----------
function t(el) { return el ? (el.textContent || "").replace(/\s+/g, " ").trim() : ""; }
function q(sel, root=document) { return root.querySelector(sel); }
function qa(sel, root=document) { return Array.from(root.querySelectorAll(sel)); }
function firstSel(selectors, root=document) {
  for (const s of selectors) {
    const el = q(s, root);
    if (el && t(el)) return el;
  }
  return null;
}

async function waitForAny(selectors, { timeout=8000, root=document } = {}) {
  const start = typeof performance !== "undefined" ? performance.now() : Date.now();

  const immediate = firstSel(selectors, root);
  if (immediate) return immediate;

  return await new Promise((resolve) => {
    const done = (node) => {
      if (observer) observer.disconnect();
      resolve(node || null);
    };

    const observer = new MutationObserver(() => {
      const el = firstSel(selectors, root);
      if (el) done(el);
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now - start > timeout) done(null);
    });
    observer.observe(root, { subtree: true, childList: true });

    setTimeout(() => done(firstSel(selectors, root)), timeout + 50);
  });
}

// ---------- text cleanup ----------
function clean(s) {
  return (s || "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function sanitizeCompany(s) {
  if (!s) return "";
  let out = s;
  out = out.replace(/\b(full[-\s]?time|part[-\s]?time|contract|internship|apprenticeship|self[-\s]?employed|freelance)\b.*$/i, "");
  out = out.replace(/\b(\d+\s*(yrs?|years?|mos?|months?|wks?|weeks?))(?:\s+\d+\s*(mos?|months?))?\b/gi, "");
  out = out.replace(/[•·]+/g, " ").replace(/\s{2,}/g, " ").trim();
  return clean(out);
}

function extractFirstName(full) {
  if (!full) return "";
  const cleanName = clean(full).replace(/[^\p{L}\p{M}\-'. ]/gu, "");
  const first = (cleanName.split(" ")[0] || "").replace(/^[^A-Za-z\p{L}\p{M}]+|[^A-Za-z\p{L}\p{M}]+$/gu, "");
  return first;
}

// ---------- selectors ----------
const NAME_SEL = [
  "h1.text-heading-xlarge",
  "div.pv-text-details__left-panel h1",
  "section.artdeco-card h1",
  "[data-view-name='profile-card'] h1",
  "main h1"
];

const HEADLINE_SEL = [
  ".pv-text-details__left-panel .text-body-medium",
  "div.inline-show-more-text",
  "[data-view-name='profile-card'] .text-body-medium",
  "section.artdeco-card .text-body-medium"
];

const EXP_SECTION_SEL = [
  "section[id*='experience']",
  "section[data-view-name='profile-experience']"
];

const ACTIVITY_SEL = [
  "section[data-view-name='profile-activities'] li span[aria-hidden='true']",
  "section:has(h2:matches-css(^Activity$)) li span[aria-hidden='true']"
];

const SKILL_SEL = [
  "section[data-view-name='profile-skills'] li span[aria-hidden='true']"
];

function extractExperience(root=document) {
  const expRoot = firstSel(EXP_SECTION_SEL, root) || root;
  const card = firstSel(["li", "article", "div.pvs-entity"], expRoot) || expRoot;

  const role = t(firstSel(["span[aria-hidden='true']", "div[dir='ltr'] span"], card));
  const companyRaw = t(firstSel(["a[href*='/company/']", "span.t-14.t-normal", "span.t-14"], card));
  const company = sanitizeCompany(companyRaw);
  const bullets = qa("li", card).map(el => t(el)).filter(Boolean).slice(0, 3);

  return { role, company, bullets };
}

function extractHeadline(root=document) {
  const h = t(firstSel(HEADLINE_SEL, root));
  if (!h) return { roleFromHeadline: "", companyFromHeadline: "" };
  const m = h.match(/^(.*?)\s+(?:at|@)\s+(.*)$/i);
  return {
    roleFromHeadline: m ? clean(m[1]) : clean(h),
    companyFromHeadline: m ? sanitizeCompany(m[2]) : ""
  };
}

function pickOneDetail(x) {
  if (x.role && x.company) return `${x.role} at ${x.company}`;
  if (x.bullets && x.bullets[0]) return x.bullets[0];
  if (x.activityArr && x.activityArr[0]) return x.activityArr[0];
  if (x.headline) return x.headline;
  if (x.school) return `student at ${x.school}`;
  return "";
}

async function extractProfileSmart() {
  await waitForAny(NAME_SEL, { timeout: 8000, root: document });

  const name = t(firstSel(NAME_SEL)) || "";
  const headlineEl = firstSel(HEADLINE_SEL);
  const headline = t(headlineEl) || "";

  const { role, company, bullets } = extractExperience();

  const eduSection = firstSel(["section[id*='education']", "section[data-view-name='profile-education']"]) || document;
  const school = t(firstSel(["li span[aria-hidden='true']", "a[href*='/school/']"], eduSection)) || "";

  const activityArr = qa(ACTIVITY_SEL).map(el => t(el)).filter(Boolean).slice(0, 3);
  const skills = qa(SKILL_SEL).map(el => t(el)).filter(Boolean).slice(0, 5);

  const { roleFromHeadline, companyFromHeadline } = extractHeadline(document);

  const roleBest = clean(role || roleFromHeadline || "");
  const companyBest = clean(
    sanitizeCompany(company) ||
    sanitizeCompany(companyFromHeadline) ||
    sanitizeCompany(school) ||
    ""
  );

  const res = {
    name: clean(name),
    headline: clean(headline),
    role: roleBest,
    company: companyBest,
    bullets,
    school: clean(school),
    activityArr,
    skills
  };

  res.detailHint = pickOneDetail(res);

  console.log("[LN][extract]", { name: res.name, role: res.role, company: res.company, detailHint: res.detailHint });
  return res;
}

function buildProfileSummary(x) {
  const parts = [];
  if (x.headline) parts.push(`headline: ${x.headline}`);
  if (x.role && x.company) parts.push(`current: ${x.role} at ${x.company}`);
  if (x.bullets && x.bullets.length) parts.push(`project: ${x.bullets[0]}`);
  if (x.activityArr && x.activityArr.length) parts.push(`recent: ${x.activityArr[0]}`);
  if (x.school) parts.push(`school: ${x.school}`);
  if (x.skills && x.skills.length) parts.push(`skills: ${x.skills.slice(0, 3).join(", ")}`);
  return clean(parts.join(" | ")).slice(0, 1200);
}

if (typeof window !== "undefined") {
  window.extractProfileSmart = extractProfileSmart;
  window.buildProfileSummary = buildProfileSummary;
  window.pickOneDetail = pickOneDetail;
  window.extractFirstName = extractFirstName;
  window.waitForAny = waitForAny;
  window.sanitizeCompany = sanitizeCompany;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    extractProfileSmart,
    buildProfileSummary,
    pickOneDetail,
    extractFirstName,
    sanitizeCompany,
    waitForAny
  };
}
