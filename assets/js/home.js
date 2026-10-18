// Home page: continue card, semester filter, subject cards.

import { loadSubjects, pad2 } from "./data.js";
import { getLast, subjectProgress } from "./progress.js";

const SUMMARIES = {
  "information-security": "Cryptography, authentication, certificates, web security, firewalls and database security.",
  "distributed-systems-cloud-computing": "Clock synchronisation, election, shared memory, system management and cloud platforms.",
  "ethical-hacking": "Footprinting, scanning, enumeration, trojans, session hijacking, SQL injection and pen testing."
};

const grid = document.getElementById("subject-grid");
const searchInput = document.getElementById("search");
const filterButtons = [...document.querySelectorAll(".filter .chip-btn")];

let subjects = [];
let semester = "all";
let query = "";

/** Create an element with optional class and text. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function applyColor(node, color) {
  node.style.setProperty("--accent", color.accent);
  node.style.setProperty("--tint", color.tint);
  node.style.setProperty("--accent-dark", color.dark);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "6 modules · 12 chapters", "6 units · 12 chapters" or "14 chapters". */
function metaLine(subject) {
  const chapters = subject.groups.reduce((n, g) => n + g.chapters.length, 0);
  const labelled = subject.groups.filter((g) => g.label);
  const parts = [];
  if (labelled.length) {
    const word = labelled[0].label.startsWith("Unit") ? "unit" : "module";
    parts.push(plural(labelled.length, word));
  }
  parts.push(plural(chapters, "chapter"));
  return parts.join(" · ");
}

function buildCard(subject) {
  const card = el("article", "card subject-card");
  card.dataset.id = subject.id;
  card.dataset.semester = subject.semester;
  applyColor(card, subject.color);

  card.append(el("div", "subject-strip"));
  const body = el("div", "subject-body");

  const head = el("div", "subject-head");
  head.append(el("span", "chip", `Semester ${subject.semester}`));
  body.append(head);

  body.append(el("h3", "", subject.name));
  body.append(el("p", "subject-meta", metaLine(subject)));
  body.append(el("p", "subject-summary", SUMMARIES[subject.id] || ""));

  const { done, total, percent } = subjectProgress(subject);
  const wrap = el("div", "progress-wrap");
  const label = el("div", "progress-label");
  label.append(el("span", "", "Progress"), el("span", "mono", `${done} of ${total} done`));
  const bar = el("div", "progress");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-label", `${subject.name} progress`);
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", String(total));
  bar.setAttribute("aria-valuenow", String(done));
  const fill = el("span");
  fill.style.width = `${percent}%`;
  bar.append(fill);
  wrap.append(label, bar);
  body.append(wrap);

  const link = el("a", "btn btn-accent btn-block", "Open subject");
  link.href = `subject.html?s=${encodeURIComponent(subject.id)}`;
  link.setAttribute("aria-label", `Open subject: ${subject.name}`);
  body.append(link);

  card.append(body);
  return card;
}

/** Does the subject match the search text (name or any chapter title)? */
function matches(subject) {
  if (!query) return true;
  const haystack = [subject.name, ...subject.groups.flatMap((g) => g.chapters.map((c) => c.title))];
  return haystack.some((t) => t.toLowerCase().includes(query));
}

/** Show or hide cards for the current semester filter and search text. */
function applyFilters() {
  let visible = 0;
  for (const card of grid.querySelectorAll(".subject-card")) {
    const subject = subjects.find((s) => s.id === card.dataset.id);
    const show = (semester === "all" || card.dataset.semester === semester) && matches(subject);
    card.hidden = !show;
    if (show) visible++;
  }
  let note = grid.querySelector(".empty-note");
  if (!visible && !note) {
    note = el("p", "empty-note", "No subjects match your filter.");
    grid.append(note);
  } else if (visible && note) {
    note.remove();
  }
}

/** Fill the "Continue practising" card from the last chapter opened. */
function renderContinue() {
  const last = getLast();
  const card = document.getElementById("continue");
  if (!last) return;
  const subject = subjects.find((s) => s.id === last.s);
  const chapter = subject && subject.groups.flatMap((g) => g.chapters).find((c) => c.no === last.ch);
  if (!chapter || !chapter.file) return;

  applyColor(card, subject.color);
  card.href = `chapter.html?s=${encodeURIComponent(subject.id)}&ch=${pad2(chapter.no)}`;
  document.getElementById("continue-title").textContent = `${pad2(chapter.no)} · ${chapter.title}`;
  document.getElementById("continue-sub").textContent = subject.name;
  card.hidden = false;
}

async function init() {
  try {
    subjects = await loadSubjects();
  } catch (err) {
    console.error(err);
    grid.replaceChildren(el("p", "empty-note", "Could not load the subjects. Please reload the page."));
    return;
  }
  grid.replaceChildren(...subjects.map(buildCard));
  renderContinue();
  applyFilters();
}

for (const button of filterButtons) {
  button.addEventListener("click", () => {
    semester = button.dataset.sem;
    for (const b of filterButtons) b.setAttribute("aria-pressed", String(b === button));
    applyFilters();
  });
}

searchInput.addEventListener("input", () => {
  query = searchInput.value.trim().toLowerCase();
  applyFilters();
});

init();
