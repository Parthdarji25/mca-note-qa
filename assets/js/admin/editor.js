// admin/editor.html: write or upload a chapter's Q&A and commit it with subjects.json.

import { requireAuth } from "./auth.js";
import { getFile, commitChanges, GitHubError } from "./github.js";
import { loadRemoteSubjects, serializeSubjects, findChapter, SUBJECTS_PATH } from "./store.js";
import { renderShell, showPushedBanner, showErrorBanner } from "./shell.js";
import { parseMarkdownQA, parseHtmlQA, serializeMarkdownQA, serializeHtmlQA } from "../qa-parser.js";
import { chapterPath, pad2, slugify } from "../data.js";
import { el, applyColor, icon } from "../dom.js";

const session = requireAuth();

const $ = (id) => document.getElementById(id);
const semesterEl = $("semester");
const subjectEl = $("subject");
const groupEl = $("group");
const noEl = $("chno");
const titleEl = $("chtitle");
const messageEl = $("message");
const cardsEl = $("cards");

const MAX_IMAGE = 2 * 1024 * 1024;
const MAX_HTML = 1024 * 1024;
const IMAGE_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

/** Everything the page knows. `orig` is what the repository holds right now. */
const st = {
  data: null, // subjects.json from the repository
  isNew: true, // chapter not yet in the syllabus
  orig: { path: null, text: null }, // current Q&A file in the repo, if any
  mode: "write", // "write" | "upload"
  questions: [], // write mode: { id, question, marks, answer }
  upload: null, // upload mode: { name, size, text, fromRepo, commit, preview }
  images: [], // pending uploads: { path, ref, base64, size }
  nextId: 1,
  dirty: false,
  messageEdited: false,
  showProblems: false,
  lastTextarea: null,
  parseNotes: []
};

/* ---------- Details form ---------- */

const subjectsOf = (semester) => st.data.subjects.filter((s) => String(s.semester) === String(semester));
const currentSubject = () => st.data.subjects.find((s) => s.id === subjectEl.value) || null;

function fillSelect(select, options, selected) {
  select.replaceChildren(
    ...options.map(([value, label]) => {
      const o = el("option", "", label);
      o.value = value;
      return o;
    })
  );
  if (selected !== undefined) select.value = String(selected);
}

function fillGroups(subject, selectedIndex = 0) {
  fillSelect(
    groupEl,
    subject.groups.map((g, i) => [String(i), g.label ? `${g.label} · ${g.name}` : g.name]),
    selectedIndex
  );
}

function onSubjectChanged() {
  const subject = currentSubject();
  if (!subject) return;
  applyColor(document.documentElement, subject.color);
  fillGroups(subject);
}

function details() {
  const subject = currentSubject();
  const no = Number(noEl.value);
  return {
    subject,
    no: Number.isInteger(no) && no >= 1 && no <= 99 ? no : null,
    title: titleEl.value.trim(),
    groupIndex: Number(groupEl.value) || 0
  };
}

function lockFields(locked) {
  for (const node of [semesterEl, subjectEl, groupEl, noEl]) node.disabled = locked;
  $("lock-hint").hidden = !locked;
}

/* ---------- Plan: what would be committed ---------- */

const contentExt = () => (st.mode === "write" ? "md" : "html");

/** The text of the Q&A file for the current mode, or null if there is nothing valid yet. */
function currentContent() {
  if (st.mode === "write") return serializeMarkdownQA(st.questions.map((q) => ({ ...q, answerMd: q.answer })));
  if (!st.upload) return null;
  return st.upload.fromRepo ? st.upload.text : serializeHtmlQA(st.upload.commit.questions);
}

function questionCount() {
  if (st.mode === "write") return st.questions.length;
  return st.upload ? st.upload.commit.questions.length : 0;
}

/** Check the form. Returns a list of problems that block the commit. */
function validate(d) {
  const errors = [];
  if (!d.subject) errors.push("Choose a subject.");
  if (d.no === null) errors.push("Chapter number must be a whole number from 1 to 99.");
  else if (st.isNew && d.subject && findChapter(d.subject, d.no)) errors.push(`Chapter ${pad2(d.no)} already exists in this subject. Pick another number, or edit it from the chapters list.`);
  if (!d.title) errors.push("Enter a chapter title.");

  if (st.mode === "write") {
    if (!st.questions.length) errors.push("Add at least one question.");
    st.questions.forEach((q, i) => {
      const n = i + 1;
      if (!q.question.trim()) errors.push(`Question ${n} has no question text.`);
      if (!q.answer.trim()) errors.push(`Question ${n} has no answer.`);
      if (q.marks !== 5 && q.marks !== 10) errors.push(`Question ${n}: marks must be 5 or 10.`);
      if (/^## Q\d+\.\s/m.test(q.answer)) errors.push(`Question ${n}: the answer contains a line that starts like a new question ("## Q1. …"). Reword it.`);
    });
  } else if (!st.upload) {
    errors.push("Choose an .html file to upload.");
  } else {
    if (st.upload.commit.errors.length) errors.push(...st.upload.commit.errors);
    if (!st.upload.commit.questions.length && !st.upload.commit.errors.length) errors.push("The uploaded file has no questions.");
  }
  return errors;
}

/** Apply this chapter's data to a subjects.json object (mutates `data`). */
function applyToSubjects(data, d, file, questions) {
  const subject = data.subjects.find((s) => s.id === d.subject.id);
  const existing = findChapter(subject, d.no);
  if (existing) {
    existing.title = d.title;
    existing.file = file;
    existing.questions = questions;
  } else {
    const group = subject.groups[d.groupIndex] || subject.groups[0];
    group.chapters.push({ no: d.no, title: d.title, file, questions });
    group.chapters.sort((a, b) => a.no - b.no);
  }
}

function computePlan() {
  const d = details();
  const errors = validate(d);
  const ready = d.subject && d.no !== null && d.title;
  const ext = contentExt();
  const path = ready ? chapterPath(d.subject, d.no, d.title, ext) : null;
  const content = currentContent();
  const files = [];
  let writeQa = false;

  if (path && content !== null) {
    if (st.orig.path === path) {
      if (st.orig.text !== content) {
        files.push({ status: "M", path });
        writeQa = true;
      }
    } else {
      files.push({ status: "A", path });
      writeQa = true;
      if (st.orig.path) files.push({ status: "D", path: st.orig.path });
    }
  }
  for (const img of st.images) files.push({ status: "A", path: img.path });

  let subjectsChanged = false;
  if (path && ready && content !== null) {
    const copy = structuredClone(st.data);
    applyToSubjects(copy, d, path.split("/").pop(), questionCount());
    subjectsChanged = serializeSubjects(copy) !== serializeSubjects(st.data);
    if (subjectsChanged) files.push({ status: "M", path: SUBJECTS_PATH });
  }
  return { d, errors, path, content, files, writeQa, subjectsChanged };
}

function defaultMessage(plan) {
  const id = plan.d.subject ? plan.d.subject.id : "subject";
  const ch = `ch${pad2(plan.d.no || 0)}`;
  const qaChanged = plan.files.some((f) => f.path === plan.path);
  if (!qaChanged && st.images.length) return `Add image: ${id} ${st.images[0].path.split("/").pop().replace(/\.[^.]+$/, "")}`;
  if (st.mode === "upload") return `Upload Q&A (html): ${id} ${ch}`;
  return `${st.orig.path ? "Update" : "Add"} Q&A: ${id} ${ch}`;
}

/* ---------- Rendering the side panels ---------- */

function refresh() {
  const plan = computePlan();
  $("saves-to").textContent = plan.path || "— (fill in the subject, number and title)";

  const list = $("files");
  if (!plan.files.length) list.replaceChildren(el("li", "muted", "No changes yet."));
  else {
    list.replaceChildren(
      ...plan.files.map((f) => {
        const li = el("li");
        li.append(el("span", `tag tag-${f.status}`, f.status), el("span", "", f.path));
        return li;
      })
    );
  }

  if (!st.messageEdited) messageEl.value = defaultMessage(plan);
  renderProblems(plan.errors);
  return plan;
}

function renderProblems(errors) {
  const box = $("problems");
  if (!st.showProblems || !errors.length) {
    box.hidden = true;
    return;
  }
  const ul = el("ul");
  errors.forEach((e) => ul.append(el("li", "", e)));
  box.replaceChildren(el("strong", "", "Fix these before committing:"), ul);
  box.hidden = false;
}

function renderNotices() {
  const box = $("notices");
  box.replaceChildren();
  if (!st.parseNotes.length) return;
  const note = el("div", "banner banner-warn");
  note.setAttribute("role", "status");
  const ul = el("ul");
  st.parseNotes.forEach((n) => ul.append(el("li", "", n)));
  note.append(el("strong", "", "About the loaded file:"), ul);
  box.append(note);
}

function markDirty() {
  st.dirty = true;
  refresh();
}

/* ---------- Write mode: question cards ---------- */

function newQuestion(data = {}) {
  return { id: st.nextId++, question: data.question || "", marks: data.marks || 5, answer: data.answer || "" };
}

function buildCard(q, i) {
  const card = el("article", "editor-card");
  const head = el("div", "editor-card-head");
  head.append(el("h3", "", `Q${i + 1}`));
  const actions = el("div", "card-actions");

  const mk = (label, path, onClick, extra = "") => {
    const b = el("button", `icon-btn ${extra}`);
    b.type = "button";
    b.setAttribute("aria-label", `${label} (question ${i + 1})`);
    b.title = label;
    b.append(icon(path));
    b.addEventListener("click", onClick);
    return b;
  };
  const up = mk("Move up", '<path d="m6 15 6-6 6 6"/>', () => move(i, -1, "up"));
  const down = mk("Move down", '<path d="m6 9 6 6 6-6"/>', () => move(i, 1, "down"));
  const del = mk("Delete question", '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', () => remove(i), "danger");
  up.disabled = i === 0;
  down.disabled = i === st.questions.length - 1;
  up.dataset.act = "up";
  down.dataset.act = "down";
  actions.append(up, down, del);
  head.append(actions);

  const row = el("div", "question-row");
  const qField = el("div", "field");
  const qLabel = el("label", "", "Question");
  qLabel.htmlFor = `q-text-${q.id}`;
  const qInput = el("input", "input");
  qInput.id = `q-text-${q.id}`;
  qInput.type = "text";
  qInput.value = q.question;
  qInput.autocomplete = "off";
  qInput.addEventListener("input", () => {
    q.question = qInput.value;
    markDirty();
  });
  qField.append(qLabel, qInput);

  const mField = el("div", "field");
  const mLabel = el("label", "", "Marks");
  mLabel.htmlFor = `q-marks-${q.id}`;
  const mSelect = el("select", "input");
  mSelect.id = `q-marks-${q.id}`;
  for (const m of [5, 10]) {
    const o = el("option", "", String(m));
    o.value = String(m);
    mSelect.append(o);
  }
  mSelect.value = String(q.marks);
  mSelect.addEventListener("change", () => {
    q.marks = Number(mSelect.value);
    markDirty();
  });
  mField.append(mLabel, mSelect);
  row.append(qField, mField);

  const aField = el("div", "field");
  const aLabel = el("label", "", "Answer (Markdown)");
  aLabel.htmlFor = `q-answer-${q.id}`;
  const aInput = el("textarea", "input");
  aInput.id = `q-answer-${q.id}`;
  aInput.value = q.answer;
  aInput.spellcheck = true;
  aInput.addEventListener("input", () => {
    q.answer = aInput.value;
    markDirty();
  });
  aInput.addEventListener("focus", () => (st.lastTextarea = { q, node: aInput }));
  aField.append(aLabel, aInput);

  card.append(head, row, aField);
  return card;
}

function renderCards(focusSelector) {
  cardsEl.replaceChildren(...st.questions.map(buildCard));
  if (!st.questions.length) cardsEl.append(el("p", "muted", "No questions yet. Choose Add question to start."));
  if (focusSelector) {
    const target = cardsEl.querySelector(focusSelector);
    if (target) target.focus();
  }
}

function move(i, delta, act) {
  const j = i + delta;
  if (j < 0 || j >= st.questions.length) return;
  [st.questions[i], st.questions[j]] = [st.questions[j], st.questions[i]];
  renderCards();
  // Keep focus on the same kind of button, on the card the question moved to.
  const card = cardsEl.children[j];
  const button = card.querySelector(`[data-act="${act}"]:not([disabled])`) || card.querySelector(".icon-btn:not([disabled])");
  if (button) button.focus();
  markDirty();
}

function remove(i) {
  const q = st.questions[i];
  const label = q.question.trim() ? `"${q.question.trim().slice(0, 60)}"` : `question ${i + 1}`;
  if (!window.confirm(`Delete ${label}?`)) return;
  st.questions.splice(i, 1);
  renderCards();
  markDirty();
}

$("add-question").addEventListener("click", () => {
  const q = newQuestion();
  st.questions.push(q);
  renderCards(`#q-text-${q.id}`);
  markDirty();
});

/* ---------- Upload mode ---------- */

const formatSize = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

function previewBase() {
  const subject = currentSubject();
  return subject ? `../${subject.folder}` : "";
}

/** Parse an uploaded or loaded HTML file twice: clean for committing, resolved for the preview. */
function buildUpload(name, text, fromRepo) {
  return {
    name,
    size: new Blob([text]).size,
    text,
    fromRepo,
    commit: parseHtmlQA(text, ""),
    preview: parseHtmlQA(text, previewBase())
  };
}

function renderUpload() {
  const info = $("upload-info");
  const warn = $("upload-warn");
  const preview = $("upload-preview");
  warn.replaceChildren();
  preview.replaceChildren();
  if (!st.upload) {
    info.textContent = "";
    return;
  }
  const u = st.upload;
  info.textContent = `${u.name} · ${formatSize(u.size)} · ${u.commit.questions.length} ${u.commit.questions.length === 1 ? "question" : "questions"} found${u.fromRepo ? " · currently saved in the repository" : ""}`;

  const notes = [];
  if (u.commit.errors.length) notes.push(["banner-error", "Problems in this file:", u.commit.errors]);
  if (u.commit.removed.length) notes.push(["banner-warn", "This will be removed from the file when it is saved:", u.commit.removed]);
  if (u.commit.warnings.length) notes.push(["banner-warn", "Warnings:", u.commit.warnings]);
  for (const [cls, title, items] of notes) {
    const box = el("div", `banner ${cls}`);
    box.style.marginTop = "8px";
    const ul = el("ul");
    items.forEach((t) => ul.append(el("li", "", t)));
    box.append(el("strong", "", title), ul);
    warn.append(box);
  }

  for (const q of u.preview.questions) {
    const card = el("article", "q-card");
    const head = el("div", "q-head");
    head.append(el("span", "q-badge", `Q${q.no}`));
    const text = el("div", "q-text-wrap");
    text.append(el("h2", "q-text", q.question), el("p", "q-marks", `${q.marks} marks`));
    head.append(text);
    const answer = el("div", "q-answer answer");
    answer.innerHTML = q.answerHtml; // sanitised by qa-parser.js
    card.append(head, answer);
    preview.append(card);
  }
}

async function handleHtmlFile(file) {
  if (!file) return;
  if (!/\.html?$/i.test(file.name)) {
    $("upload-info").textContent = "Please choose a .html or .htm file.";
    return;
  }
  if (file.size > MAX_HTML) {
    $("upload-info").textContent = `That file is ${formatSize(file.size)}. The limit is 1 MB.`;
    return;
  }
  st.upload = buildUpload(file.name, await file.text(), false);
  renderUpload();
  markDirty();
}

const dropzone = $("dropzone");
$("html-input").addEventListener("change", (e) => {
  handleHtmlFile(e.target.files[0]);
  e.target.value = "";
});
["dragenter", "dragover"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add("is-over");
  })
);
["dragleave", "drop"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove("is-over");
  })
);
dropzone.addEventListener("drop", (e) => handleHtmlFile(e.dataTransfer.files[0]));

/* ---------- Mode switch ---------- */

function setMode(mode) {
  st.mode = mode;
  const write = mode === "write";
  $("tab-write").setAttribute("aria-selected", String(write));
  $("tab-upload").setAttribute("aria-selected", String(!write));
  $("write-pane").hidden = !write;
  $("upload-pane").hidden = write;
  if (!write) renderUpload();
  refresh();
}

$("tab-write").addEventListener("click", () => setMode("write"));
$("tab-upload").addEventListener("click", () => setMode("upload"));
for (const tab of [$("tab-write"), $("tab-upload")]) {
  tab.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const next = tab === $("tab-write") ? $("tab-upload") : $("tab-write");
    next.focus();
    next.click();
  });
}

/* ---------- Image upload ---------- */

function readBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

$("image-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  const status = $("image-status");
  if (!file) return;
  const d = details();
  const ext = IMAGE_TYPES[file.type];
  if (!d.subject || d.no === null) {
    status.textContent = "Fill in the subject and chapter number first, so the image gets the right name.";
    return;
  }
  if (!ext) {
    status.textContent = "Only PNG, JPG, GIF or WebP images are allowed.";
    return;
  }
  if (file.size > MAX_IMAGE) {
    status.textContent = `That image is ${(file.size / 1048576).toFixed(1)} MB. The limit is 2 MB.`;
    return;
  }
  const base = slugify(file.name.replace(/\.[^.]+$/, "")) || "image";
  const ref = `images/ch${pad2(d.no)}-${base}.${ext}`;
  const path = `${d.subject.folder}/${ref}`;
  const base64 = await readBase64(file);
  st.images = st.images.filter((img) => img.path !== path).concat({ path, ref, base64, size: file.size });

  if (st.mode === "write" && st.lastTextarea && st.lastTextarea.node.isConnected) {
    const { q, node } = st.lastTextarea;
    const snippet = `![${base}](${ref})`;
    const at = node.selectionStart ?? node.value.length;
    node.value = `${node.value.slice(0, at)}${snippet}${node.value.slice(node.selectionEnd ?? at)}`;
    q.answer = node.value;
    status.textContent = `Added ${ref} and inserted ${snippet} into the answer.`;
  } else if (st.mode === "write") {
    status.textContent = `Added ${ref}. Click inside an answer first to insert it there, or type ![${base}](${ref}).`;
  } else {
    status.textContent = `Added ${ref}. Use <img src="${ref}" alt="${base}"> in your HTML.`;
  }
  markDirty();
});

/* ---------- Commit and discard ---------- */

messageEl.addEventListener("input", () => (st.messageEdited = true));
for (const node of [semesterEl, subjectEl, groupEl, noEl, titleEl]) {
  node.addEventListener("input", () => {
    if (node === semesterEl) {
      fillSelect(subjectEl, subjectsOf(semesterEl.value).map((s) => [s.id, s.name]));
      onSubjectChanged();
    } else if (node === subjectEl) onSubjectChanged();
    if (st.mode === "upload" && st.upload && !st.upload.fromRepo) st.upload.preview = parseHtmlQA(st.upload.text, previewBase());
    markDirty();
  });
}

$("commit-btn").addEventListener("click", async () => {
  st.showProblems = true;
  const plan = refresh();
  if (plan.errors.length) {
    $("problems").scrollIntoView({ block: "nearest" });
    return;
  }
  if (!plan.files.length) {
    $("problems").replaceChildren(el("strong", "", "There is nothing to commit."), el("p", "", "The files already match the repository."));
    $("problems").hidden = false;
    return;
  }
  const message = messageEl.value.trim();
  if (!message) {
    $("problems").replaceChildren(el("strong", "", "Write a commit message first."));
    $("problems").hidden = false;
    return;
  }

  const button = $("commit-btn");
  button.disabled = true;
  button.textContent = "Committing…";
  $("problems").hidden = true;
  $("banner").hidden = true;
  try {
    const fresh = await loadRemoteSubjects();
    const d = plan.d;
    const file = plan.path.split("/").pop();
    const fresher = fresh.subjects.find((s) => s.id === d.subject.id);
    if (st.isNew && findChapter(fresher, d.no)) throw new GitHubError(`Chapter ${pad2(d.no)} was added by someone else. Reload the page.`, 0);
    applyToSubjects(fresh, d, file, questionCount());

    const put = { [SUBJECTS_PATH]: serializeSubjects(fresh) };
    const del = [];
    if (plan.writeQa) put[plan.path] = plan.content;
    for (const f of plan.files) if (f.status === "D") del.push(f.path);
    for (const img of st.images) put[img.path] = { base64: img.base64 };

    const commit = await commitChanges({ message, put, delete: del });

    // The repository now matches the form: make it the new baseline.
    st.data = fresh;
    st.orig = { path: plan.path, text: plan.content };
    if (st.mode === "upload" && st.upload) st.upload.fromRepo = true;
    st.images = [];
    st.isNew = false;
    st.dirty = false;
    st.messageEdited = false;
    st.showProblems = false;
    lockFields(true);
    history.replaceState(null, "", `?s=${encodeURIComponent(d.subject.id)}&ch=${pad2(d.no)}`);
    showPushedBanner($("banner"), commit, { href: `../chapter.html?s=${encodeURIComponent(d.subject.id)}&ch=${pad2(d.no)}`, text: "View Q&A page" });
    $("banner").scrollIntoView({ block: "nearest" });
    refresh();
  } catch (err) {
    showErrorBanner($("banner"), err instanceof GitHubError ? err.message : `Could not commit: ${err.message}`);
    $("banner").scrollIntoView({ block: "nearest" });
  } finally {
    button.disabled = false;
    button.textContent = `Commit and push to ${session.branch}`;
  }
});

$("discard-btn").addEventListener("click", () => {
  if (st.dirty && !window.confirm("Discard all unsaved changes and reload from GitHub?")) return;
  st.dirty = false;
  location.reload();
});

window.addEventListener("beforeunload", (e) => {
  if (st.dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});

/* ---------- Start up ---------- */

async function loadExisting(subject, chapter) {
  const path = `${subject.folder}/${chapter.file}`;
  const file = await getFile(path);
  if (!file) {
    st.parseNotes.push(`The file ${path} is listed in subjects.json but was not found in the repository.`);
    return;
  }
  st.orig = { path, text: file.text };
  if (/\.html?$/i.test(chapter.file)) {
    st.upload = buildUpload(chapter.file, file.text, true);
    st.mode = "upload";
    return;
  }
  const parsed = parseMarkdownQA(file.text, "");
  st.questions = parsed.questions.map((q) => newQuestion({ question: q.question, marks: q.marks, answer: q.answerMd }));
  st.parseNotes.push(...parsed.errors.map((e) => `${e} That question was skipped and will be dropped if you save.`), ...parsed.warnings);
}

async function init() {
  renderShell("editor");
  if (!session) return;
  $("commit-btn").textContent = `Commit and push to ${session.branch}`;

  try {
    st.data = await loadRemoteSubjects();
  } catch (err) {
    showErrorBanner($("banner"), err instanceof GitHubError ? err.message : `Could not load subjects.json: ${err.message}`);
    return;
  }

  const params = new URLSearchParams(location.search);
  const subject = st.data.subjects.find((s) => s.id === params.get("s")) || null;
  const wantedNo = Number(params.get("ch"));
  const chapter = subject && wantedNo ? findChapter(subject, wantedNo) : null;

  const semesters = [...new Set(st.data.subjects.map((s) => s.semester))].sort();
  fillSelect(semesterEl, semesters.map((n) => [String(n), `Semester ${n}`]), (subject || st.data.subjects[0]).semester);
  fillSelect(subjectEl, subjectsOf(semesterEl.value).map((s) => [s.id, s.name]), (subject || subjectsOf(semesterEl.value)[0]).id);
  onSubjectChanged();

  if (chapter) {
    st.isNew = false;
    const groupIndex = subject.groups.findIndex((g) => g.chapters.includes(chapter));
    groupEl.value = String(groupIndex);
    noEl.value = String(chapter.no);
    titleEl.value = chapter.title;
    lockFields(true);
    $("page-title").textContent = `${pad2(chapter.no)} · ${chapter.title}`;
    document.title = `Edit ${pad2(chapter.no)} ${chapter.title} · MCA Notes Admin`;
    if (chapter.file) {
      try {
        await loadExisting(subject, chapter);
      } catch (err) {
        showErrorBanner($("banner"), err instanceof GitHubError ? err.message : `Could not load the file: ${err.message}`);
      }
    }
  } else {
    $("page-title").textContent = "New chapter";
    if (subject) {
      const used = subject.groups.flatMap((g) => g.chapters.map((c) => c.no));
      noEl.value = String(Math.max(0, ...used) + 1);
    }
    if (params.get("ch")) st.parseNotes.push(`Chapter ${params.get("ch")} does not exist in this subject yet, so this creates a new chapter.`);
  }

  if (st.mode === "write" && !st.questions.length && !st.orig.path) st.questions.push(newQuestion());
  renderCards();
  renderNotices();
  setMode(st.mode);
  st.dirty = false;
}

init();
