// Home page: continue card, semester filter, subject cards.

import { loadSubjects } from "./data.js";
import { getLast, subjectProgress } from "./progress.js";
import { el, applyColor, plural } from "./dom.js";

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
let query = (new URLSearchParams(location.search).get("q") || "").trim().toLowerCase();

/** "7 questions" or "No questions yet". */
function metaLine(subject) {
  return subject.file && subject.questions > 0 ? plural(subject.questions, "question") : "No questions yet";
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

  const { seen, total, percent } = subjectProgress(subject);
  const wrap = el("div", "progress-wrap");
  const label = el("div", "progress-label");
  label.append(el("span", "", "Progress"), el("span", "mono", `${seen} of ${total} seen`));
  const bar = el("div", "progress");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-label", `${subject.name} progress`);
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", String(total));
  bar.setAttribute("aria-valuenow", String(seen));
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

/** Does the subject name match the search text? */
function matches(subject) {
  return !query || subject.name.toLowerCase().includes(query);
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

/** Fill the "Continue practising" card from the last subject opened. */
function renderContinue() {
  const last = getLast();
  const card = document.getElementById("continue");
  if (!last) return;
  const subject = subjects.find((s) => s.id === last.s);
  if (!subject || !subject.file) return;

  const { seen, total } = subjectProgress(subject);
  applyColor(card, subject.color);
  card.href = `subject.html?s=${encodeURIComponent(subject.id)}`;
  document.getElementById("continue-title").textContent = subject.name;
  document.getElementById("continue-sub").textContent = `${seen} of ${plural(total, "question")} seen`;
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

searchInput.value = new URLSearchParams(location.search).get("q") || "";

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
