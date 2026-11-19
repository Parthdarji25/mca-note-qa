// admin/questions.html: the questions of each subject, with edit and delete.

import { requireAuth } from "./auth.js";
import { listCommits, commitChanges, GitHubError } from "./github.js";
import { loadRemoteSubjects, loadRemoteBank, planBankChange, chaptersIn, yearsIn } from "./store.js";
import { renderShell, showPushedBanner, showErrorBanner } from "./shell.js";
import { el, plural } from "../dom.js";

const session = requireAuth();

const $ = (id) => document.getElementById(id);
const banner = $("banner");
const tabsEl = $("tabs");
const tableWrap = $("table-wrap");
const tableTitle = $("table-title");
const addButton = $("add-question");
const fileLine = $("file-line");
const notesEl = $("bank-notes");
const filtersEl = $("list-filters");
const dialog = $("delete-dialog");
const deleteForm = $("delete-form");
const deleteMessage = $("delete-message");
const deleteError = $("delete-error");
const deleteConfirm = $("delete-confirm");

const NONE = "__none__";

let data = null; // { subjects: [...] } from the repository
let subjectId = null;
const banks = new Map(); // subject id -> { path, questions, notes }
let pending = null; // { subject, index, question, path, opener } while the delete dialog is open

const formatDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const currentSubject = () => data.subjects.find((s) => s.id === subjectId);
const editorUrl = (subject, position) => `editor.html?s=${encodeURIComponent(subject.id)}${position ? `&q=${position}` : ""}`;

/* ---------- Tabs ---------- */

function renderTabs() {
  tabsEl.replaceChildren(
    ...data.subjects.map((s) => {
      const b = el("button", "tab", s.name);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(s.id === subjectId));
      b.addEventListener("click", () => selectSubject(s.id));
      return b;
    })
  );
}

async function selectSubject(id) {
  subjectId = id;
  history.replaceState(null, "", `?s=${encodeURIComponent(id)}`);
  $("f-text").value = "";
  $("f-marks").value = "all"; // the year and chapter lists are refilled by setupFilters()
  renderTabs();
  await showSubject();
}

/* ---------- Table ---------- */

/** Load (once) and show the current subject's questions. */
async function showSubject() {
  const subject = currentSubject();
  tableTitle.textContent = subject.name;
  addButton.href = editorUrl(subject);
  notesEl.replaceChildren();
  fileLine.textContent = "";
  filtersEl.hidden = true;

  if (!banks.has(subject.id)) {
    tableWrap.replaceChildren(el("p", "panel", "Loading questions from GitHub…"));
    try {
      banks.set(subject.id, await loadRemoteBank(subject));
    } catch (err) {
      if (subject.id !== subjectId) return; // the tab changed while loading
      tableWrap.replaceChildren(el("p", "panel", "The questions could not be loaded."));
      showErrorBanner(banner, err instanceof GitHubError ? err.message : `Could not load the questions: ${err.message}`);
      return;
    }
    if (subject.id !== subjectId) return;
  }
  const bank = banks.get(subject.id);

  tableTitle.textContent = `${subject.name} · ${plural(bank.questions.length, "question")}`;
  renderFileLine(bank);
  if (bank.notes.length) {
    const box = el("div", "banner banner-warn");
    box.setAttribute("role", "status");
    const ul = el("ul");
    bank.notes.forEach((n) => ul.append(el("li", "", n)));
    box.append(el("strong", "", "About this file:"), ul);
    notesEl.replaceChildren(box);
  }
  setupFilters(bank);
  renderTable();
}

function renderFileLine(bank) {
  if (!bank.path) {
    fileLine.textContent = "No questions yet. Choose Add question to create the file.";
    return;
  }
  fileLine.replaceChildren(el("span", "", "File: "), el("code", "mono", bank.path));
  const cell = el("span", "muted");
  fileLine.append(cell);
  fillLastChange(cell, bank.path);
}

/** Add the date of the newest commit touching the file to the file line. */
async function fillLastChange(cell, path) {
  try {
    const [commit] = await listCommits(path, 1);
    if (!commit) return;
    const a = el("a", "", formatDate(commit.date));
    a.href = commit.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = commit.message;
    cell.append(document.createTextNode(" · last change "), a);
  } catch {
    // The date is only informational.
  }
}

function fillSelect(select, options) {
  select.replaceChildren(
    ...options.map(([value, label]) => {
      const o = el("option", "", label);
      o.value = String(value);
      return o;
    })
  );
}

/** Show the search and filters when there is something to filter, and fill the year and chapter lists. */
function setupFilters(bank) {
  const qs = bank.questions;
  filtersEl.hidden = qs.length === 0;
  const years = yearsIn(qs);
  const chapters = chaptersIn(qs);
  $("f-year-field").hidden = years.length === 0;
  $("f-chapter-field").hidden = chapters.length === 0;
  fillSelect($("f-year"), [["all", "All years"], ...years.map((y) => [y, String(y)]), ...(years.length && qs.some((q) => !q.years.length) ? [[NONE, "No year tagged"]] : [])]);
  fillSelect($("f-chapter"), [["all", "All chapters"], ...chapters.map((c) => [c, c]), ...(chapters.length && qs.some((q) => !q.chapter) ? [[NONE, "No chapter tag"]] : [])]);
}

function rowMatches(q) {
  const text = $("f-text").value.trim().toLowerCase();
  const marks = $("f-marks").value;
  const year = $("f-year").value;
  const chapter = $("f-chapter").value;
  if (text && !`${q.question} ${q.chapter} ${q.years.join(" ")}`.toLowerCase().includes(text)) return false;
  if (marks !== "all" && q.marks !== Number(marks)) return false;
  if (year === NONE ? q.years.length > 0 : year !== "all" && !q.years.includes(Number(year))) return false;
  if (chapter === NONE ? q.chapter !== "" : chapter !== "all" && q.chapter !== chapter) return false;
  return true;
}

function renderTable() {
  const subject = currentSubject();
  const bank = banks.get(subject.id);
  if (!bank.questions.length) {
    tableWrap.replaceChildren(el("p", "panel", "There are no questions in this subject yet."));
    return;
  }

  const table = el("table", "data-table stack-table");
  const head = el("thead");
  const hr = el("tr");
  for (const label of ["No.", "Question", "Marks", "Chapter", "Years", "Actions"]) {
    const th = el("th", "", label);
    th.scope = "col";
    hr.append(th);
  }
  head.append(hr);
  const body = el("tbody");
  let shown = 0;
  bank.questions.forEach((q, i) => {
    if (!rowMatches(q)) return;
    shown++;
    body.append(buildRow(subject, q, i));
  });
  table.append(head, body);
  if (!shown) {
    tableWrap.replaceChildren(el("p", "panel", "No questions match these filters."));
    return;
  }
  tableWrap.replaceChildren(table);
}

function buildRow(subject, q, index) {
  const position = index + 1;
  const row = el("tr");
  const cell = (label, className) => {
    const td = el("td", className || "");
    td.dataset.label = label;
    return td;
  };

  const no = cell("No.", "num");
  no.textContent = `Q${position}`;
  const text = cell("Question", "q-cell");
  text.textContent = q.question;
  const marks = cell("Marks");
  marks.textContent = String(q.marks);

  const chapter = cell("Chapter");
  if (q.chapter) chapter.append(el("span", "tag tag-chapter", q.chapter));
  else chapter.append(el("span", "muted", "—"));

  const years = cell("Years");
  if (q.years.length) {
    const wrap = el("span", "tag-list");
    q.years.forEach((y) => wrap.append(el("span", "tag tag-year", String(y))));
    years.append(wrap);
  } else {
    years.append(el("span", "muted", "—"));
  }

  const actions = cell("Actions", "actions-cell");
  const buttons = el("div", "row-actions");
  const edit = el("a", "btn btn-sm", "Edit");
  edit.href = editorUrl(subject, position);
  edit.setAttribute("aria-label", `Edit question ${position}`);
  const del = el("button", "btn btn-sm btn-danger", "Delete");
  del.type = "button";
  del.setAttribute("aria-label", `Delete question ${position}`);
  del.addEventListener("click", () => openDelete(subject, index, del));
  buttons.append(edit, del);
  actions.append(buttons);

  row.append(no, text, marks, chapter, years, actions);
  return row;
}

for (const id of ["f-text", "f-marks", "f-year", "f-chapter"]) {
  $(id).addEventListener("input", () => banks.has(subjectId) && renderTable());
}

/* ---------- Recent commits ---------- */

async function renderRecent() {
  const list = $("recent");
  try {
    const commits = await listCommits("qa", 5);
    if (!commits.length) {
      list.replaceChildren(el("li", "muted", "No commits touching qa/ yet."));
      return;
    }
    list.replaceChildren(
      ...commits.map((c) => {
        const li = el("li");
        const a = el("a", "", c.message);
        a.href = c.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        li.append(a, el("span", "meta mono", `${c.short} · ${formatDate(c.date)}`));
        return li;
      })
    );
  } catch (err) {
    list.replaceChildren(el("li", "muted", err instanceof GitHubError ? err.message : "Could not load commits."));
  }
}

/* ---------- Delete ---------- */

function openDelete(subject, index, opener) {
  const bank = banks.get(subject.id);
  const question = bank.questions[index];
  pending = { subject, index, question, path: bank.path, opener };
  const last = bank.questions.length === 1;
  $("delete-what").textContent = last
    ? `This removes Q${index + 1} "${question.question}". It is the only question, so the file is deleted and the subject goes back to "Coming soon", all in one commit.`
    : `This removes Q${index + 1} "${question.question}" and renumbers the questions after it, in one commit.`;
  $("delete-path").textContent = bank.path;
  deleteMessage.value = `Delete Q&A: ${subject.id} Q${index + 1}`;
  deleteError.hidden = true;
  deleteConfirm.disabled = false;
  deleteConfirm.textContent = "Delete and commit";
  dialog.showModal();
  deleteMessage.focus();
}

function closeDelete() {
  dialog.close();
  if (pending && pending.opener && pending.opener.isConnected) pending.opener.focus();
}

$("delete-cancel").addEventListener("click", closeDelete);

deleteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!pending) return;
  const { subject, index, question } = pending;
  deleteConfirm.disabled = true;
  deleteConfirm.textContent = "Committing…";
  deleteError.hidden = true;
  try {
    // Re-read both files so the commit builds on the newest copies.
    const fresh = await loadRemoteSubjects();
    const freshSubject = fresh.subjects.find((s) => s.id === subject.id);
    const freshBank = await loadRemoteBank(freshSubject);
    const current = freshBank.questions[index];
    if (!current || current.question !== question.question) {
      throw new GitHubError("That question was changed by someone else. Reload the page and try again.", 0);
    }
    const list = freshBank.questions.filter((_, i) => i !== index);
    const plan = planBankChange(fresh, subject.id, freshBank.path, list);
    const commit = await commitChanges({ message: deleteMessage.value.trim(), put: plan.put, delete: plan.delete });

    data = fresh;
    banks.set(subject.id, { path: plan.path, questions: list, notes: [] });
    dialog.close();
    showPushedBanner(banner, commit, { href: `../subject.html?s=${encodeURIComponent(subject.id)}`, text: "View Q&A page" });
    await showSubject();
    renderRecent();
  } catch (err) {
    showErrorBanner(deleteError, err instanceof GitHubError ? err.message : `Could not delete: ${err.message}`);
    deleteConfirm.disabled = false;
    deleteConfirm.textContent = "Delete and commit";
  }
});

/* ---------- Start up ---------- */

async function init() {
  renderShell("questions");
  if (!session) return;
  try {
    data = await loadRemoteSubjects();
  } catch (err) {
    tableWrap.replaceChildren(el("p", "panel", "The subjects could not be loaded."));
    showErrorBanner(banner, err instanceof GitHubError ? err.message : `Could not load subjects.json: ${err.message}`);
    return;
  }
  const wanted = new URLSearchParams(location.search).get("s");
  subjectId = data.subjects.some((s) => s.id === wanted) ? wanted : data.subjects[0].id;
  renderTabs();
  renderRecent();
  await showSubject();
}

init();
