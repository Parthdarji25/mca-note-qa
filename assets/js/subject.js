// Subject page: chapter list, progress, and the "Download all" zip.

import { loadSubjects, pad2, REPO, BRANCH } from "./data.js";
import { chapterStatus, getLast, resetSubject, subjectProgress } from "./progress.js";
import { el, applyColor, plural } from "./dom.js";

const main = document.getElementById("main");
const searchInput = document.getElementById("search");

const STATUS_LABEL = { done: "Done", progress: "In progress", todo: "Not started", none: "Coming soon" };

let subjects = [];
let subject = null;

const allChapters = (s) => s.groups.flatMap((g) => g.chapters);
const chapterUrl = (s, c) => `chapter.html?s=${encodeURIComponent(s.id)}&ch=${pad2(c.no)}`;

function groupWord(s) {
  const labelled = s.groups.filter((g) => g.label);
  if (!labelled.length) return null;
  return labelled[0].label.startsWith("Unit") ? "unit" : "module";
}

function countsLine(s) {
  const word = groupWord(s);
  const questions = allChapters(s).reduce((n, c) => n + (c.file ? c.questions : 0), 0);
  const parts = [`Semester ${s.semester}`];
  if (word) parts.push(plural(s.groups.length, word));
  parts.push(plural(allChapters(s).length, "chapter"), `${questions} questions so far`);
  return parts.join(" · ");
}

function renderNotFound() {
  document.title = "Subject not found · MCA Notes";
  const box = el("div", "container not-found");
  const link = el("a", "btn btn-primary", "Back to all subjects");
  link.href = "index.html#subjects";
  box.append(
    el("h1", "", "Subject not found"),
    el("p", "", "We couldn't find that subject. The link may be wrong or out of date."),
    link
  );
  main.replaceChildren(box);
}

/** The chapter the "Continue" button should open, or null. */
function continueChapter() {
  const withFile = allChapters(subject).filter((c) => c.file);
  const last = getLast();
  if (last && last.s === subject.id) {
    const c = withFile.find((x) => x.no === last.ch);
    if (c) return c;
  }
  return withFile.find((c) => chapterStatus(subject.id, c) !== "done") || null;
}

function buildHero() {
  const hero = el("section", "subject-hero");
  const inner = el("div", "container");

  const crumbs = el("ol", "breadcrumb");
  const home = el("li");
  const homeLink = el("a", "", "Home");
  homeLink.href = "index.html";
  home.append(homeLink);
  const here = el("li", "", subject.name);
  here.setAttribute("aria-current", "page");
  crumbs.append(home, here);
  const nav = el("nav");
  nav.setAttribute("aria-label", "Breadcrumb");
  nav.append(crumbs);

  inner.append(nav, el("h1", "", subject.name), el("p", "hero-stats", countsLine(subject)));

  const actions = el("div", "hero-actions");
  const next = continueChapter();
  if (next) {
    const a = el("a", "btn btn-on-accent", `Continue: ${pad2(next.no)} · ${next.title}`);
    a.href = chapterUrl(subject, next);
    actions.append(a);
  }
  const gh = el("a", "btn btn-outline-light", "Q&A folder on GitHub");
  gh.href = `https://github.com/${REPO}/tree/${BRANCH}/${subject.folder}`;
  gh.target = "_blank";
  gh.rel = "noopener noreferrer";
  actions.append(gh);
  inner.append(actions);

  hero.append(inner);
  return hero;
}

function buildRow(c) {
  const status = chapterStatus(subject.id, c);
  const available = status !== "none";
  const row = el(available ? "a" : "div", `chapter-row${available ? "" : " is-soon"}`);
  if (available) row.href = chapterUrl(subject, c);

  const dot = el("span", `status-dot ${status}`);
  dot.setAttribute("aria-hidden", "true");
  row.append(
    dot,
    el("span", "chapter-no", pad2(c.no)),
    el("span", "chapter-title", c.title),
    el("span", "chapter-status", STATUS_LABEL[status]),
    el("span", "chapter-count", available ? `${c.questions} Qs` : "—")
  );
  return row;
}

function buildChapterList() {
  const wrap = el("div", "chapters");
  const query = searchInput.value.trim().toLowerCase();
  let shown = 0;

  for (const group of subject.groups) {
    const chapters = group.chapters.filter((c) => !query || c.title.toLowerCase().includes(query));
    if (!chapters.length) continue;
    shown += chapters.length;

    const section = el("section", "chapter-group");
    const heading = el("div", "group-title");
    if (group.label) heading.append(el("span", "group-label", group.label));
    heading.append(el("h2", "group-name", group.name));
    const list = el("ul", "card chapter-list");
    for (const c of chapters) {
      const li = el("li");
      li.append(buildRow(c));
      list.append(li);
    }
    section.append(heading, list);
    wrap.append(section);
  }
  if (!shown) wrap.append(el("p", "empty-note", "No chapters match your search."));
  return wrap;
}

function buildProgressCard() {
  const { done, total, percent } = subjectProgress(subject);
  const card = el("section", "card side-card");
  card.append(el("h2", "", "Your progress"));

  const label = el("div", "progress-label");
  label.append(el("span", "", "Chapters done"), el("span", "mono", `${done} of ${total}`));
  const bar = el("div", "progress");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-label", `${subject.name} progress`);
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", String(total));
  bar.setAttribute("aria-valuenow", String(done));
  const fill = el("span");
  fill.style.width = `${percent}%`;
  bar.append(fill);

  const reset = el("button", "btn btn-sm btn-danger btn-block", "Reset progress");
  reset.type = "button";
  reset.style.marginTop = "16px";
  reset.addEventListener("click", () => {
    if (!window.confirm(`Reset your progress for ${subject.name}? This cannot be undone.`)) return;
    resetSubject(subject.id);
    render();
  });

  card.append(label, bar, reset);
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

function buildOthersCard() {
  const card = el("section", "card side-card");
  card.append(el("h2", "", "Other subjects"));
  const list = el("ul", "side-links");
  for (const other of subjects.filter((s) => s.id !== subject.id)) {
    const li = el("li");
    const a = el("a");
    a.href = `subject.html?s=${encodeURIComponent(other.id)}`;
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

/** Fetch every existing Q&A file of the subject and offer them as <subject-id>-qa.zip. */
async function downloadZip(button, note) {
  const files = allChapters(subject).filter((c) => c.file);
  note.classList.remove("is-error");
  if (!files.length) {
    note.textContent = "There are no Q&A files for this subject yet.";
    return;
  }
  if (typeof JSZip === "undefined") {
    note.classList.add("is-error");
    note.textContent = "The zip library could not be loaded. Check your connection and reload.";
    return;
  }

  button.disabled = true;
  note.textContent = "Preparing zip…";
  try {
    const zip = new JSZip();
    await Promise.all(
      files.map(async (c) => {
        const res = await fetch(`${subject.folder}/${c.file}`);
        if (!res.ok) throw new Error(`${c.file} (HTTP ${res.status})`);
        zip.file(c.file, await res.arrayBuffer());
      })
    );
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = el("a");
    a.href = url;
    a.download = `${subject.id}-qa.zip`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    note.textContent = `Downloaded ${plural(files.length, "file")}.`;
  } catch (err) {
    console.error(err);
    note.classList.add("is-error");
    note.textContent = `Could not build the zip: ${err.message}`;
  } finally {
    button.disabled = false;
  }
}

/** Draw the whole page for the current subject and progress. */
function render() {
  const layout = el("div", "container subject-layout");
  const side = el("aside", "side");
  side.setAttribute("aria-label", "Subject sidebar");
  side.append(buildProgressCard(), buildResourcesCard(), buildOthersCard());
  layout.append(buildChapterList(), side);
  main.replaceChildren(buildHero(), layout);
}

/** Redraw only the chapter list (used while searching). */
function renderList() {
  const current = main.querySelector(".chapters");
  if (current) current.replaceWith(buildChapterList());
}

async function init() {
  const id = new URLSearchParams(location.search).get("s");
  try {
    subjects = await loadSubjects();
  } catch (err) {
    console.error(err);
    main.replaceChildren(el("p", "container not-found", "Could not load the subjects. Please reload the page."));
    return;
  }
  subject = subjects.find((s) => s.id === id);
  if (!subject) {
    renderNotFound();
    return;
  }
  document.title = `${subject.name} · MCA Notes`;
  applyColor(document.documentElement, subject.color);
  render();
}

searchInput.addEventListener("input", () => {
  if (subject) renderList();
});

init();
