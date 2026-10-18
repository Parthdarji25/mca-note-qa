// Chapter page: Q&A reader.

import { loadSubjects, pad2, REPO, BRANCH } from "./data.js";
import { parseQA } from "./qa-parser.js";
import { getSeen, markSeen, setLast } from "./progress.js";
import { el, applyColor, plural, icon } from "./dom.js";

const main = document.getElementById("main");

let subject = null;
let chapter = null;
let questions = [];
let filter = "all"; // "all" | 5 | 10
const seen = new Set();
const cards = new Map(); // question no -> { card, toggle, answer }
let summaryEls = [];
let progressFills = [];

const chapterUrl = (s, c) => `chapter.html?s=${encodeURIComponent(s.id)}&ch=${pad2(c.no)}`;
const subjectUrl = (s) => `subject.html?s=${encodeURIComponent(s.id)}`;

function showMessage(title, text, linkHref, linkText) {
  document.title = `${title} · MCA Notes`;
  const box = el("div", "container not-found");
  box.append(el("h1", "", title), el("p", "", text));
  if (linkHref) {
    const a = el("a", "btn btn-primary", linkText);
    a.href = linkHref;
    box.append(a);
  }
  main.replaceChildren(box);
}

function summaryText() {
  const five = questions.filter((q) => q.marks === 5).length;
  const ten = questions.length - five;
  const parts = [plural(questions.length, "question")];
  if (five) parts.push(`5 marks × ${five}`);
  if (ten) parts.push(`10 marks × ${ten}`);
  parts.push(`${seen.size} of ${questions.length} done`);
  return parts.join(" · ");
}

function updateSummary() {
  for (const node of summaryEls) node.textContent = summaryText();
  const pct = questions.length ? Math.round((seen.size / questions.length) * 100) : 0;
  for (const fill of progressFills) {
    fill.style.width = `${pct}%`;
    fill.parentElement.setAttribute("aria-valuenow", String(seen.size));
  }
}

/** Open or close one answer; opening records progress. */
function setOpen(no, open) {
  const entry = cards.get(no);
  if (!entry) return;
  entry.toggle.setAttribute("aria-expanded", String(open));
  entry.answer.hidden = !open;
  entry.label.textContent = open ? "Hide answer" : "Show answer";
  entry.sign.textContent = open ? "−" : "+";
  if (open && !seen.has(no)) {
    seen.add(no);
    markSeen(subject.id, chapter.no, no);
    updateSummary();
  }
}

function buildCard(q) {
  const card = el("article", "q-card");
  card.id = `q${q.no}`;
  card.dataset.marks = q.marks;

  const head = el("div", "q-head");
  head.append(el("span", "q-badge", `Q${q.no}`));
  const text = el("div", "q-text-wrap");
  text.append(el("h2", "q-text", q.question), el("p", "q-marks", `${q.marks} marks`));

  const toggle = el("button", "q-toggle");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", `a${q.no}`);
  const label = el("span", "q-toggle-label", "Show answer");
  const sign = el("span", "q-sign", "+");
  sign.setAttribute("aria-hidden", "true");
  toggle.append(label, sign);
  head.append(text, toggle);

  const answer = el("div", "q-answer answer");
  answer.id = `a${q.no}`;
  answer.hidden = true;
  answer.innerHTML = q.answerHtml; // sanitised by qa-parser.js

  card.append(head, answer);
  cards.set(q.no, { card, toggle, answer, label, sign });
  toggle.addEventListener("click", () => setOpen(q.no, toggle.getAttribute("aria-expanded") !== "true"));
  return card;
}

function visibleQuestions() {
  return questions.filter((q) => filter === "all" || q.marks === filter);
}

function buildToolbar(onFilter) {
  const bar = el("div", "toolbar");
  const chips = el("div", "chips");
  chips.setAttribute("role", "group");
  chips.setAttribute("aria-label", "Filter by marks");
  const options = [["all", "All"], [5, "5 marks"], [10, "10 marks"]];
  const buttons = options.map(([value, text]) => {
    const b = el("button", "chip-btn", text);
    b.type = "button";
    b.setAttribute("aria-pressed", String(value === filter));
    b.addEventListener("click", () => {
      filter = value;
      buttons.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      onFilter();
    });
    return b;
  });
  chips.append(...buttons);

  const actions = el("div", "toolbar-actions");
  const expand = el("button", "btn btn-sm", "Expand all");
  const collapse = el("button", "btn btn-sm", "Collapse all");
  expand.type = collapse.type = "button";
  expand.addEventListener("click", () => visibleQuestions().forEach((q) => setOpen(q.no, true)));
  collapse.addEventListener("click", () => visibleQuestions().forEach((q) => setOpen(q.no, false)));
  actions.append(expand, collapse);

  bar.append(chips, actions);
  return bar;
}

function buildHeader(subjectEl) {
  // Desktop header
  const desk = el("div", "c-head");
  const nav = el("nav");
  nav.setAttribute("aria-label", "Breadcrumb");
  const crumbs = el("ol", "breadcrumb");
  const items = [["Home", "index.html"], [subject.name, subjectUrl(subject)]];
  for (const [text, href] of items) {
    const li = el("li");
    const a = el("a", "", text);
    a.href = href;
    li.append(a);
    crumbs.append(li);
  }
  const here = el("li", "", `Chapter ${pad2(chapter.no)}`);
  here.setAttribute("aria-current", "page");
  crumbs.append(here);
  nav.append(crumbs);
  const summary = el("p", "c-summary");
  summary.setAttribute("aria-live", "polite");
  desk.append(nav, el("h1", "c-title", chapter.title), summary);

  // Phone header
  const mob = el("div", "m-header");
  const back = el("a", "m-back");
  back.href = subjectUrl(subject);
  back.setAttribute("aria-label", `Back to ${subject.name}`);
  back.append(icon('<path d="M19 12H5m6-6-6 6 6 6"/>'));
  const mtext = el("div", "m-text");
  const msummary = el("p", "c-summary");
  mtext.append(el("p", "m-subject", subject.name), el("h1", "m-title", `${pad2(chapter.no)} · ${chapter.title}`), msummary);
  const bar = el("div", "progress m-progress");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-label", "Questions seen");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", String(questions.length));
  const fill = el("span");
  bar.append(fill);
  mob.append(back, mtext, bar);

  summaryEls = [summary, msummary];
  progressFills = [fill];
  subjectEl.append(desk, mob);
}

function buildSide(path, jumpList) {
  const side = el("aside", "side");
  side.setAttribute("aria-label", "Chapter sidebar");

  const jump = el("section", "card side-card");
  jump.append(el("h2", "", "Jump to"), jumpList);

  const source = el("section", "card side-card");
  source.append(el("h2", "", "Source file"));
  source.append(el("p", "source-path mono", path));
  const edit = el("a", "btn btn-sm btn-block", "Edit on GitHub");
  edit.href = `https://github.com/${REPO}/edit/${BRANCH}/${path}`;
  edit.target = "_blank";
  edit.rel = "noopener noreferrer";
  edit.style.marginTop = "12px";
  source.append(edit);

  side.append(jump, source);
  return side;
}

function buildPager() {
  const flat = subject.groups.flatMap((g) => g.chapters).filter((c) => c.file);
  const i = flat.findIndex((c) => c.no === chapter.no);
  const prev = flat[i - 1];
  const next = flat[i + 1];
  const wrap = el("nav", "pager");
  wrap.setAttribute("aria-label", "Chapter navigation");
  const make = (c, dir) => {
    if (!c) return el("span", "pager-spacer");
    const a = el("a", `card pager-card ${dir}`);
    a.href = chapterUrl(subject, c);
    a.append(el("span", "pager-dir", dir === "prev" ? "Previous chapter" : "Next chapter"), el("span", "pager-title", `${pad2(c.no)} · ${c.title}`));
    return a;
  };
  wrap.append(make(prev, "prev"), make(next, "next"));
  return wrap;
}

function renderReader(result) {
  const path = `${subject.folder}/${chapter.file}`;
  const root = el("div");
  const top = el("div", "container chapter-top");
  buildHeader(top);

  const notices = el("div", "notices");
  if (result.errors.length || result.warnings.length) {
    const box = el("div", "notice");
    box.setAttribute("role", "status");
    const list = el("ul");
    for (const msg of [...result.errors, ...result.warnings]) list.append(el("li", "", msg));
    box.append(el("strong", "", "This chapter has problems:"), list);
    notices.append(box);
  }

  const list = el("div", "q-list");
  const jumpList = el("ol", "jump-list");

  const redraw = () => {
    const vis = visibleQuestions();
    for (const q of questions) cards.get(q.no).card.hidden = !vis.includes(q);
    jumpList.replaceChildren(
      ...vis.map((q) => {
        const li = el("li");
        const a = el("a", "", `Q${q.no} · ${q.marks} marks`);
        a.href = `#q${q.no}`;
        li.append(a);
        return li;
      })
    );
    empty.hidden = vis.length > 0;
  };
  const empty = el("p", "empty-note", "No questions match this filter.");
  empty.hidden = true;

  list.append(...questions.map(buildCard), empty);

  const toolbar = buildToolbar(redraw);
  const layout = el("div", "container chapter-layout");
  const col = el("div", "chapter-main");
  col.append(toolbar, list, buildPager());
  layout.append(col, buildSide(path, jumpList));

  root.append(top, notices, layout);
  main.replaceChildren(root);

  getSeen(subject.id, chapter.no).forEach((n) => questions.some((q) => q.no === n) && seen.add(n));
  redraw();
  updateSummary();
  // First two answers open by default.
  questions.slice(0, 2).forEach((q) => setOpen(q.no, true));
}

async function init() {
  const params = new URLSearchParams(location.search);
  let subjects;
  try {
    subjects = await loadSubjects();
  } catch (err) {
    console.error(err);
    showMessage("Could not load", "The subject list could not be loaded. Please reload the page.", "index.html", "Back to home");
    return;
  }
  subject = subjects.find((s) => s.id === params.get("s"));
  if (!subject) {
    showMessage("Subject not found", "We couldn't find that subject. The link may be wrong or out of date.", "index.html#subjects", "Back to all subjects");
    return;
  }
  applyColor(document.documentElement, subject.color);
  const no = Number(params.get("ch"));
  chapter = subject.groups.flatMap((g) => g.chapters).find((c) => c.no === no);
  if (!chapter) {
    showMessage("Chapter not found", "That chapter doesn't exist in this subject.", subjectUrl(subject), `Back to ${subject.name}`);
    return;
  }
  if (!chapter.file) {
    showMessage("Coming soon", `Chapter ${pad2(chapter.no)} · ${chapter.title} doesn't have questions yet.`, subjectUrl(subject), `Back to ${subject.name}`);
    return;
  }

  document.title = `${pad2(chapter.no)} ${chapter.title} · ${subject.name} · MCA Notes`;
  setLast(subject.id, chapter.no);

  let text;
  try {
    const res = await fetch(`${subject.folder}/${chapter.file}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (err) {
    console.error(err);
    showMessage("Could not load the questions", `The file ${subject.folder}/${chapter.file} could not be loaded (${err.message}).`, subjectUrl(subject), `Back to ${subject.name}`);
    return;
  }

  const result = parseQA(chapter.file, text, subject.folder);
  if (!result.questions.length) {
    showMessage("This chapter can't be shown", result.errors.join(" ") || "No questions were found in the file.", subjectUrl(subject), `Back to ${subject.name}`);
    return;
  }
  questions = result.questions;
  renderReader(result);
}

init();
