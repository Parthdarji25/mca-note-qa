// admin/chapters.html: chapter list per subject, with delete.

import { requireAuth } from "./auth.js";
import { listCommits, commitChanges, GitHubError } from "./github.js";
import { loadRemoteSubjects, serializeSubjects, findChapter, SUBJECTS_PATH } from "./store.js";
import { renderShell, showPushedBanner, showErrorBanner } from "./shell.js";
import { el, plural } from "../dom.js";
import { pad2 } from "../data.js";

const session = requireAuth();

const banner = document.getElementById("banner");
const tabsEl = document.getElementById("tabs");
const tableWrap = document.getElementById("table-wrap");
const tableTitle = document.getElementById("table-title");
const addButton = document.getElementById("add-chapter");
const dialog = document.getElementById("delete-dialog");
const deleteForm = document.getElementById("delete-form");
const deleteMessage = document.getElementById("delete-message");
const deleteError = document.getElementById("delete-error");
const deleteConfirm = document.getElementById("delete-confirm");

let data = null; // { subjects: [...] } from the repository
let subjectId = null;
let pending = null; // { subject, chapter, path } while the delete dialog is open

const formatDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const currentSubject = () => data.subjects.find((s) => s.id === subjectId);
const filePath = (subject, chapter) => `${subject.folder}/${chapter.file}`;
const editorUrl = (subject, chapter) => `editor.html?s=${encodeURIComponent(subject.id)}&ch=${pad2(chapter.no)}`;

function renderTabs() {
  tabsEl.replaceChildren(
    ...data.subjects.map((s) => {
      const b = el("button", "tab", s.name);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(s.id === subjectId));
      b.addEventListener("click", () => {
        subjectId = s.id;
        history.replaceState(null, "", `?s=${encodeURIComponent(s.id)}`);
        renderTabs();
        renderTable();
      });
      return b;
    })
  );
}

function renderTable() {
  const subject = currentSubject();
  const count = subject.groups.reduce((n, g) => n + g.chapters.length, 0);
  tableTitle.textContent = `${subject.name} · ${plural(count, "chapter")}`;
  addButton.href = `editor.html?s=${encodeURIComponent(subject.id)}`;

  const table = el("table", "data-table");
  const head = el("thead");
  const hr = el("tr");
  for (const label of ["No.", "Chapter", "File", "Last change", "Actions"]) {
    const th = el("th", "", label);
    th.scope = "col";
    hr.append(th);
  }
  head.append(hr);
  const body = el("tbody");

  for (const group of subject.groups) {
    if (group.label) {
      const row = el("tr", "group-row");
      const th = el("th", "", `${group.label} · ${group.name}`);
      th.colSpan = 5;
      th.scope = "colgroup";
      row.append(th);
      body.append(row);
    }
    for (const chapter of group.chapters) body.append(buildRow(subject, chapter));
  }
  table.append(head, body);
  tableWrap.replaceChildren(table);
}

function buildRow(subject, chapter) {
  const row = el("tr");
  row.append(el("td", "num", pad2(chapter.no)), el("td", "", chapter.title));

  const fileCell = el("td", "file");
  const changeCell = el("td", "muted", "—");
  const actions = el("td");
  const buttons = el("div", "row-actions");

  if (chapter.file) {
    fileCell.textContent = chapter.file;
    const edit = el("a", "btn btn-sm", "Edit");
    edit.href = editorUrl(subject, chapter);
    edit.setAttribute("aria-label", `Edit chapter ${pad2(chapter.no)} ${chapter.title}`);
    const del = el("button", "btn btn-sm btn-danger", "Delete");
    del.type = "button";
    del.setAttribute("aria-label", `Delete chapter ${pad2(chapter.no)} ${chapter.title}`);
    del.addEventListener("click", () => openDelete(subject, chapter, del));
    buttons.append(edit, del);
    fillLastChange(changeCell, filePath(subject, chapter));
  } else {
    fileCell.append(el("span", "muted", "No file yet"));
    const create = el("a", "btn btn-sm btn-primary", "Create file");
    create.href = editorUrl(subject, chapter);
    create.setAttribute("aria-label", `Create file for chapter ${pad2(chapter.no)} ${chapter.title}`);
    buttons.append(create);
  }
  actions.append(buttons);
  row.append(fileCell, changeCell, actions);
  return row;
}

/** Fill the "Last change" cell with the date of the newest commit touching the file. */
async function fillLastChange(cell, path) {
  try {
    const [commit] = await listCommits(path, 1);
    if (!commit) return;
    cell.textContent = "";
    const a = el("a", "", formatDate(commit.date));
    a.href = commit.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = commit.message;
    cell.append(a);
  } catch {
    // Leave the dash: the date is only informational.
  }
}

async function renderRecent() {
  const list = document.getElementById("recent");
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

function openDelete(subject, chapter, opener) {
  pending = { subject, chapter, path: filePath(subject, chapter), opener };
  document.getElementById("delete-path").textContent = pending.path;
  deleteMessage.value = `Delete Q&A: ${subject.id} ch${pad2(chapter.no)}`;
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

document.getElementById("delete-cancel").addEventListener("click", closeDelete);

deleteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!pending) return;
  const { subject, chapter, path } = pending;
  deleteConfirm.disabled = true;
  deleteConfirm.textContent = "Committing…";
  deleteError.hidden = true;
  try {
    // Re-read subjects.json so the commit builds on the newest copy.
    const fresh = await loadRemoteSubjects();
    const target = findChapter(fresh.subjects.find((s) => s.id === subject.id), chapter.no);
    if (!target) throw new GitHubError("That chapter no longer exists in subjects.json. Reload the page.", 0);
    target.file = null;
    target.questions = 0;

    const commit = await commitChanges({
      message: deleteMessage.value.trim(),
      put: { [SUBJECTS_PATH]: serializeSubjects(fresh) },
      delete: [path]
    });
    data = fresh;
    dialog.close();
    showPushedBanner(banner, commit, { href: `../subject.html?s=${encodeURIComponent(subject.id)}`, text: "View subject page" });
    renderTable();
    renderRecent();
  } catch (err) {
    showErrorBanner(deleteError, err instanceof GitHubError ? err.message : `Could not delete: ${err.message}`);
    deleteConfirm.disabled = false;
    deleteConfirm.textContent = "Delete and commit";
  }
});

async function init() {
  renderShell("chapters");
  if (!session) return;
  try {
    data = await loadRemoteSubjects();
  } catch (err) {
    tableWrap.replaceChildren(el("p", "panel", ""));
    showErrorBanner(banner, err instanceof GitHubError ? err.message : `Could not load subjects.json: ${err.message}`);
    return;
  }
  const wanted = new URLSearchParams(location.search).get("s");
  subjectId = data.subjects.some((s) => s.id === wanted) ? wanted : data.subjects[0].id;
  renderTabs();
  renderTable();
  renderRecent();
}

init();
