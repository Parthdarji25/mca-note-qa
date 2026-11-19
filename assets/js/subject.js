// Subject page: the Q&A reader. One subject = one list of questions, filtered by marks,
// year asked and chapter tag, with progress, a jump list and the "Download all" zip.

import { loadSubjects, REPO, BRANCH } from "./data.js";
import { parseQA } from "./qa-parser.js";
import { getSeen, markSeen, setLast, pruneSeen, questionKey } from "./progress.js";
import { el, applyColor, plural } from "./dom.js";

const main = document.getElementById("main");
const searchInput = document.getElementById("search");

/** Select value meaning "questions that have no year / no chapter tag". */
const NONE = "__none__";

let subjects = [];
let subject = null;
let questions = [];
const seen = new Set();
const cards = new Map(); // question no -> { card, toggle, answer, label, sign, jump }
const filters = { marks: "all", year: "all", chapter: "all", text: "" };

// Elements that show progress, refreshed together by updateProgress().
let progressTexts = [];
let progressFills = [];

/** Re-apply the filters to the cards on screen. Set by render(). */
let redrawList = () => {};

const subjectUrl = (s) => `subject.html?s=${encodeURIComponent(s.id)}`;
const qaPath = () => `${subject.folder}/${subject.file}`;

/* ---------- Messages ---------- */

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

/* ---------- Filters ---------- */

/** Read the filters from the address bar so a filtered view can be shared. */
function readFilters() {
  const p = new URLSearchParams(location.search);
  const marks = Number(p.get("marks"));
  filters.marks = marks === 5 || marks === 10 ? marks : "all";
  const year = p.get("year");
  filters.year = year === NONE ? NONE : /^\d{4}$/.test(year || "") ? Number(year) : "all";
  filters.chapter = p.get("chapter") || "all";
  filters.text = (p.get("q") || "").trim();
  searchInput.value = filters.text;
}

/** Write the active filters back to the address bar (no new history entry). */
function writeFilters() {
  const p = new URLSearchParams({ s: subject.id });
  if (filters.marks !== "all") p.set("marks", filters.marks);
  if (filters.year !== "all") p.set("year", filters.year);
  if (filters.chapter !== "all") p.set("chapter", filters.chapter);
  if (filters.text) p.set("q", filters.text);
  history.replaceState(null, "", `?${p}${location.hash}`);
}

const filtersActive = () => filters.marks !== "all" || filters.year !== "all" || filters.chapter !== "all" || filters.text !== "";

function matchesFilters(q) {
  if (filters.marks !== "all" && q.marks !== filters.marks) return false;
  if (filters.year === NONE ? q.years.length > 0 : filters.year !== "all" && !q.years.includes(filters.year)) return false;
  if (filters.chapter === NONE ? q.chapter !== "" : filters.chapter !== "all" && q.chapter !== filters.chapter) return false;
  return !filters.text || q.haystack.includes(filters.text.toLowerCase());
}

const visibleQuestions = () => questions.filter(matchesFilters);

/** Lower-case text the search box looks through: question, tags and the answer's plain text. */
function buildHaystack(q) {
  const answerText = new DOMParser().parseFromString(q.answerHtml, "text/html").body.textContent;
  return `${q.question} ${q.chapter} ${q.years.join(" ")} ${answerText}`.replace(/\s+/g, " ").toLowerCase();
}

/* ---------- Progress ---------- */

function updateProgress() {
  const total = questions.length;
  const pct = total ? Math.round((seen.size / total) * 100) : 0;
  for (const node of progressTexts) node.textContent = `${seen.size} of ${total} seen`;
  for (const fill of progressFills) {
    fill.style.width = `${pct}%`;
    fill.parentElement.setAttribute("aria-valuenow", String(seen.size));
  }
  for (const q of questions) cards.get(q.no).jump.classList.toggle("is-seen", seen.has(q.key));
}

/** Open or close one answer; opening records progress. */
function setOpen(no, open) {
  const entry = cards.get(no);
  if (!entry) return;
  entry.toggle.setAttribute("aria-expanded", String(open));
  entry.answer.hidden = !open;
  entry.label.textContent = open ? "Hide answer" : "Show answer";
  entry.sign.textContent = open ? "−" : "+";
  const q = questions[no - 1];
  if (open && !seen.has(q.key)) {
    seen.add(q.key);
    markSeen(subject.id, q.key);
    updateProgress();
  }
}

/* ---------- Building the page ---------- */

function marksSummary() {
  const five = questions.filter((q) => q.marks === 5).length;
  const ten = questions.length - five;
  const parts = [`Semester ${subject.semester}`, plural(questions.length, "question")];
  if (five) parts.push(`5 marks × ${five}`);
  if (ten) parts.push(`10 marks × ${ten}`);
  return parts.join(" · ");
}

function buildBreadcrumb() {
  const nav = el("nav");
  nav.setAttribute("aria-label", "Breadcrumb");
  const crumbs = el("ol", "breadcrumb");
  const home = el("li");
  const homeLink = el("a", "", "Home");
  homeLink.href = "index.html";
  home.append(homeLink);
  const here = el("li", "", subject.name);
  here.setAttribute("aria-current", "page");
  crumbs.append(home, here);
  nav.append(crumbs);
  return nav;
}

function buildProgressBar(label) {
  const bar = el("div", "progress");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-label", label);
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", String(questions.length));
  bar.setAttribute("aria-valuenow", "0");
  const fill = el("span");
  bar.append(fill);
  progressFills.push(fill);
  return bar;
}

function buildHero() {
  const hero = el("section", "subject-hero");
  const inner = el("div", "container");
  inner.append(buildBreadcrumb(), el("h1", "", subject.name));
  if (questions.length) {
    const progress = el("div", "hero-progress");
    const label = el("span", "mono");
    progressTexts.push(label);
    progress.append(label, buildProgressBar(`${subject.name} questions seen`));
    inner.append(el("p", "hero-stats", marksSummary()), progress);
  }

  const actions = el("div", "hero-actions");
  const gh = el("a", "btn btn-outline-light", "Q&A folder on GitHub");
  gh.href = `https://github.com/${REPO}/tree/${BRANCH}/${subject.folder}`;
  gh.target = "_blank";
  gh.rel = "noopener noreferrer";
  actions.append(gh);
  inner.append(actions);

  hero.append(inner);
  return hero;
}

/** Tags under a question: marks, optional chapter, optional years. */
function buildMeta(q) {
  const meta = el("div", "q-meta");
  meta.append(el("span", "q-marks", `${q.marks} marks`));
  if (q.chapter) meta.append(el("span", "tag tag-chapter", q.chapter));
  for (const y of q.years) {
    const tag = el("span", "tag tag-year", String(y));
    tag.title = `Asked in ${y}`;
    meta.append(tag);
  }
  return meta;
}

function buildCard(q) {
  const card = el("article", "q-card");
  card.id = `q${q.no}`;
  card.dataset.marks = q.marks;

  const head = el("div", "q-head");
  head.append(el("span", "q-badge", `Q${q.no}`));
  const text = el("div", "q-text-wrap");
  text.append(el("h2", "q-text", q.question), buildMeta(q));

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
  const jump = el("a", "jump-link", String(q.no));
  jump.href = `#q${q.no}`;
  jump.setAttribute("aria-label", `Question ${q.no}, ${q.marks} marks`);
  cards.set(q.no, { card, toggle, answer, label, sign, jump });
  toggle.addEventListener("click", () => setOpen(q.no, toggle.getAttribute("aria-expanded") !== "true"));
  return card;
}

/** A labelled <select> for the year or chapter filter. */
function buildSelect(id, label, options, current, onChange) {
  const field = el("div", "select-field");
  const lab = el("label", "", label);
  lab.htmlFor = id;
  const select = el("select", "input");
  select.id = id;
  for (const [value, text] of options) {
    const o = el("option", "", text);
    o.value = String(value);
    select.append(o);
  }
  select.value = String(current);
  select.addEventListener("change", () => onChange(select.value));
  field.append(lab, select);
  return field;
}

/** Options for a tag filter: all, each value, and "none" only when tagged and untagged questions are mixed. */
function tagOptions(allLabel, noneLabel, values, hasUntagged) {
  const options = [["all", allLabel], ...values.map((v) => [v, String(v)])];
  if (values.length && hasUntagged) options.push([NONE, noneLabel]);
  return options;
}

function buildToolbar(redraw) {
  const bar = el("div", "toolbar");

  // Row 1: marks chips and expand/collapse.
  const top = el("div", "toolbar-row");
  const chips = el("div", "chips");
  chips.setAttribute("role", "group");
  chips.setAttribute("aria-label", "Filter by marks");
  const buttons = [["all", "All"], [5, "5 marks"], [10, "10 marks"]].map(([value, text]) => {
    const b = el("button", "chip-btn", text);
    b.type = "button";
    b.setAttribute("aria-pressed", String(value === filters.marks));
    b.dataset.value = String(value);
    b.addEventListener("click", () => {
      filters.marks = value;
      redraw();
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
  top.append(chips, actions);
  bar.append(top);

  // Row 2: year and chapter selects, shown only when some question has that tag.
  const years = [...new Set(questions.flatMap((q) => q.years))].sort((a, b) => b - a);
  const chapters = [...new Set(questions.map((q) => q.chapter).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const selects = el("div", "toolbar-row filter-selects");
  if (years.length) {
    const options = tagOptions("All years", "No year tagged", years, questions.some((q) => !q.years.length));
    if (!options.some(([v]) => String(v) === String(filters.year))) filters.year = "all";
    selects.append(buildSelect("filter-year", "Year asked", options, filters.year, (v) => {
      filters.year = v === "all" || v === NONE ? v : Number(v);
      redraw();
    }));
  } else {
    filters.year = "all";
  }
  if (chapters.length) {
    const options = tagOptions("All chapters", "No chapter tag", chapters, questions.some((q) => !q.chapter));
    if (!options.some(([v]) => v === filters.chapter)) filters.chapter = "all";
    selects.append(buildSelect("filter-chapter", "Chapter", options, filters.chapter, (v) => {
      filters.chapter = v;
      redraw();
    }));
  } else {
    filters.chapter = "all";
  }
  if (selects.children.length) bar.append(selects);

  // Row 3: result count and "Clear filters".
  const status = el("div", "toolbar-row toolbar-status");
  const count = el("p", "result-count");
  count.setAttribute("aria-live", "polite");
  const clear = el("button", "link-btn", "Clear filters");
  clear.type = "button";
  clear.addEventListener("click", () => {
    Object.assign(filters, { marks: "all", year: "all", chapter: "all", text: "" });
    searchInput.value = "";
    redraw();
  });
  status.append(count, clear);
  bar.append(status);

  /** Bring the controls in line with the filter state. */
  bar.sync = (shown) => {
    for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.value === String(filters.marks)));
    const y = selects.querySelector("#filter-year");
    const c = selects.querySelector("#filter-chapter");
    if (y) y.value = String(filters.year);
    if (c) c.value = filters.chapter;
    count.textContent = filtersActive() ? `Showing ${shown} of ${plural(questions.length, "question")}` : plural(questions.length, "question");
    clear.hidden = !filtersActive();
  };
  return bar;
}

function buildProgressCard() {
  const card = el("section", "card side-card");
  card.append(el("h2", "", "Your progress"));
  const label = el("div", "progress-label");
  label.append(el("span", "", "Questions seen"));
  const text = el("span", "mono");
  progressTexts.push(text);
  label.append(text);
  card.append(label, buildProgressBar(`${subject.name} progress`));
  return card;
}

function buildJumpCard(jumpList) {
  const card = el("section", "card side-card");
  card.append(el("h2", "", "Jump to"), jumpList);
  return card;
}

function buildResourcesCard() {
  const card = el("section", "card side-card");
  card.append(el("h2", "", "Resources"));
  const button = el("button", "btn btn-sm btn-block", "Download all Q&A (.zip)");
  button.type = "button";
  const note = el("p", "side-note");
  note.setAttribute("role", "status");
  button.addEventListener("click", () => downloadZip(button, note));
  card.append(button, note);
  return card;
}

function buildSourceCard() {
  const card = el("section", "card side-card");
  card.append(el("h2", "", "Source file"), el("p", "source-path mono", qaPath()));
  const edit = el("a", "btn btn-sm btn-block", "Edit on GitHub");
  edit.href = `https://github.com/${REPO}/edit/${BRANCH}/${qaPath()}`;
  edit.target = "_blank";
  edit.rel = "noopener noreferrer";
  edit.style.marginTop = "12px";
  card.append(edit);
  return card;
}

function buildOthersCard() {
  const card = el("section", "card side-card");
  card.append(el("h2", "", "Other subjects"));
  const list = el("ul", "side-links");
  for (const other of subjects.filter((s) => s.id !== subject.id)) {
    const li = el("li");
    const a = el("a");
    a.href = subjectUrl(other);
    const name = el("span");
    const dot = el("span", "dot");
    dot.style.background = other.color.accent;
    dot.setAttribute("aria-hidden", "true");
    name.append(dot, document.createTextNode(other.name));
    a.append(name, el("span", "mono", `Sem ${other.semester}`));
    li.append(a);
    list.append(li);
  }
  card.append(list);
  return card;
}

/** Fetch the subject's Q&A file and offer it as <subject-id>-qa.zip. */
async function downloadZip(button, note) {
  note.classList.remove("is-error");
  if (typeof JSZip === "undefined") {
    note.classList.add("is-error");
    note.textContent = "The zip library could not be loaded. Check your connection and reload.";
    return;
  }
  button.disabled = true;
  note.textContent = "Preparing zip…";
  try {
    const zip = new JSZip();
    const res = await fetch(qaPath());
    if (!res.ok) throw new Error(`${subject.file} (HTTP ${res.status})`);
    zip.file(subject.file, await res.arrayBuffer());
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = el("a");
    a.href = url;
    a.download = `${subject.id}-qa.zip`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    note.textContent = `Downloaded ${plural(questions.length, "question")}.`;
  } catch (err) {
    console.error(err);
    note.classList.add("is-error");
    note.textContent = `Could not build the zip: ${err.message}`;
  } finally {
    button.disabled = false;
  }
}

/** Draw the whole page for the current subject, questions and progress. */
function render(result) {
  progressTexts = [];
  progressFills = [];
  cards.clear();

  const list = el("div", "q-list");
  const jumpList = el("div", "jump-grid");
  const empty = el("p", "empty-note", "No questions match these filters.");
  empty.hidden = true;
  list.append(...questions.map(buildCard), empty);

  const toolbar = buildToolbar(() => redrawList());
  redrawList = () => {
    const vis = new Set(visibleQuestions());
    for (const q of questions) cards.get(q.no).card.hidden = !vis.has(q);
    jumpList.replaceChildren(...[...vis].map((q) => cards.get(q.no).jump));
    empty.hidden = vis.size > 0;
    toolbar.sync(vis.size);
    writeFilters();
  };

  const notices = el("div", "notices");
  if (result && (result.errors.length || result.warnings.length)) {
    const box = el("div", "notice");
    box.setAttribute("role", "status");
    const ul = el("ul");
    for (const msg of [...result.errors, ...result.warnings]) ul.append(el("li", "", msg));
    box.append(el("strong", "", "This question file has problems:"), ul);
    notices.append(box);
  }

  const col = el("div", "reader-main");
  col.append(notices, toolbar, list);
  const side = el("aside", "side");
  side.setAttribute("aria-label", "Subject sidebar");
  side.append(buildProgressCard(), buildJumpCard(jumpList), buildResourcesCard(), buildSourceCard(), buildOthersCard());
  const layout = el("div", "container subject-layout");
  layout.append(col, side);

  main.replaceChildren(buildHero(), layout);
  searchInput.disabled = false;
  redrawList();
  updateProgress();

  // First two answers open by default; a #q5 link opens that one instead.
  const target = /^#q(\d+)$/.exec(location.hash);
  if (target && cards.has(Number(target[1]))) {
    setOpen(Number(target[1]), true);
    cards.get(Number(target[1])).card.scrollIntoView();
  } else {
    visibleQuestions().slice(0, 2).forEach((q) => setOpen(q.no, true));
  }
}

function renderEmpty() {
  progressTexts = [];
  progressFills = [];
  const box = el("div", "container not-found");
  const link = el("a", "btn btn-primary", "Back to all subjects");
  link.href = "index.html#subjects";
  box.append(el("h2", "", "Coming soon"), el("p", "", `${subject.name} doesn't have any questions yet. Check back later.`), link);
  main.replaceChildren(buildHero(), box);
  searchInput.disabled = true;
}

async function init() {
  const id = new URLSearchParams(location.search).get("s");
  try {
    subjects = await loadSubjects();
  } catch (err) {
    console.error(err);
    showMessage("Could not load", "The subject list could not be loaded. Please reload the page.", "index.html", "Back to home");
    return;
  }
  subject = subjects.find((s) => s.id === id);
  if (!subject) {
    showMessage("Subject not found", "We couldn't find that subject. The link may be wrong or out of date.", "index.html#subjects", "Back to all subjects");
    return;
  }
  document.title = `${subject.name} · MCA Notes`;
  applyColor(document.documentElement, subject.color);

  if (!subject.file) {
    renderEmpty();
    return;
  }

  let text;
  try {
    const res = await fetch(qaPath());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (err) {
    console.error(err);
    showMessage("Could not load the questions", `The file ${qaPath()} could not be loaded (${err.message}).`, "index.html#subjects", "Back to all subjects");
    return;
  }

  const result = parseQA(subject.file, text, subject.folder);
  if (!result.questions.length) {
    showMessage("These questions can't be shown", result.errors.join(" ") || "No questions were found in the file.", "index.html#subjects", "Back to all subjects");
    return;
  }
  questions = result.questions.map((q) => ({ ...q, key: questionKey(q.question), haystack: buildHaystack(q) }));

  // Progress belongs to questions that still exist.
  pruneSeen(subject.id, questions.map((q) => q.key));
  for (const key of getSeen(subject.id)) seen.add(key);
  setLast(subject.id);

  readFilters();
  render(result);
}

searchInput.addEventListener("input", () => {
  if (!questions.length) return;
  filters.text = searchInput.value.trim();
  redrawList();
});

init();
