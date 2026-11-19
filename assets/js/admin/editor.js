// admin/editor.html: add or edit one question, or import an .html file of questions,
// and commit the subject's question file with data/subjects.json.

import { requireAuth } from "./auth.js";
import { commitChanges, GitHubError } from "./github.js";
import { loadRemoteSubjects, loadRemoteBank, planBankChange, serializeBank, serializeSubjects, chaptersIn, yearsIn, SUBJECTS_PATH } from "./store.js";
import { renderShell, showPushedBanner, showErrorBanner } from "./shell.js";
import { parseHtmlQA, parseYears, normalizeChapter, htmlAnswerToMarkdown, MIN_YEAR, MAX_YEAR } from "../qa-parser.js";
import { qaPath, slugify } from "../data.js";
import { el, applyColor, plural } from "../dom.js";

const session = requireAuth();

const $ = (id) => document.getElementById(id);
const semesterEl = $("semester");
const subjectEl = $("subject");
const chapterEl = $("chapter");
const yearsEl = $("years");
const textEl = $("q-text");
const marksEl = $("q-marks");
const positionEl = $("q-position");
const answerEl = $("q-answer");
const messageEl = $("message");

const MAX_IMAGE = 2 * 1024 * 1024;
const MAX_HTML = 1024 * 1024;
const IMAGE_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

/** Everything the page knows. `bank` is what the repository holds right now for the chosen subject. */
const st = {
  data: null, // subjects.json from the repository
  bank: { path: null, questions: [], notes: [] },
  bankLoading: false,
  index: null, // 0-based position of the question being edited; null when adding
  orig: null, // the question as it was loaded, to detect edits made by someone else
  mode: "write", // "write" | "upload"
  upload: null, // import mode: { name, size, text, commit, preview }
  images: [], // pending uploads: { path, ref, base64, size }
  dirty: false,
  messageEdited: false,
  showProblems: false,
  positionTouched: false,
  answerFocused: false,
  parseNotes: []
};

/* ---------- Details form ---------- */

const subjectsOf = (semester) => st.data.subjects.filter((s) => String(s.semester) === String(semester));
const currentSubject = () => (st.data ? st.data.subjects.find((s) => s.id === subjectEl.value) : null) || null;

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

function lockFields(locked) {
  semesterEl.disabled = locked;
  subjectEl.disabled = locked;
  $("lock-hint").hidden = !locked;
}

/** The question as typed in the form. */
function draft() {
  return {
    question: textEl.value.replace(/\s+/g, " ").trim(),
    marks: Number(marksEl.value),
    chapter: normalizeChapter(chapterEl.value),
    years: parseYears(yearsEl.value).years,
    answer: answerEl.value
  };
}

/** Highest allowed value of "Question no.". */
const maxPosition = () => (st.index === null ? st.bank.questions.length + 1 : st.bank.questions.length);

/* ---------- Plan: what would be committed ---------- */

/**
 * The question list after this change, built on `base` (the subject's current questions).
 * @param {Array<object>} base
 * @returns {{list: Array<object>, position: ?number}} `position` is where the written question lands (1-based).
 */
function buildList(base) {
  if (st.mode === "write") {
    const list = base.slice();
    if (st.index !== null) list.splice(st.index, 1);
    const wanted = Number(positionEl.value);
    const position = Number.isInteger(wanted) && wanted >= 1 ? Math.min(wanted, list.length + 1) : list.length + 1;
    list.splice(position - 1, 0, draft());
    return { list, position };
  }
  if (!st.upload) return { list: base.slice(), position: null };
  const defaults = { chapter: normalizeChapter(chapterEl.value), years: parseYears(yearsEl.value).years };
  const imported = st.upload.commit.questions.map((q) => ({
    question: q.question,
    marks: q.marks,
    chapter: q.chapter || defaults.chapter,
    years: q.years.length ? q.years : defaults.years,
    answer: htmlAnswerToMarkdown(q.answerHtml)
  }));
  return { list: base.concat(imported), position: null };
}

/** Check the form. Returns a list of problems that block the commit. */
function validate() {
  const errors = [];
  if (!currentSubject()) errors.push("Choose a subject.");
  if (st.bankLoading) errors.push("The subject's questions are still loading. Try again in a moment.");

  const years = parseYears(yearsEl.value);
  if (years.invalid.length) errors.push(`These are not valid years: ${years.invalid.join(", ")}. Use four digits between ${MIN_YEAR} and ${MAX_YEAR}.`);

  if (st.mode === "write") {
    const d = draft();
    if (!d.question) errors.push("Enter the question.");
    if (!d.answer.trim()) errors.push("Write the answer.");
    if (d.marks !== 5 && d.marks !== 10) errors.push("Marks must be 5 or 10.");
    if (/^## Q\d+\.\s/m.test(d.answer)) errors.push('The answer contains a line that starts like a new question ("## Q1. …"). Reword it.');
    if (positionEl.value !== "") {
      const n = Number(positionEl.value);
      if (!Number.isInteger(n) || n < 1 || n > maxPosition()) errors.push(`Question no. must be a whole number from 1 to ${maxPosition()}.`);
    }
  } else if (!st.upload) {
    errors.push("Choose an .html file to import.");
  } else {
    errors.push(...st.upload.commit.errors);
    if (!st.upload.commit.questions.length && !st.upload.commit.errors.length) errors.push("The file has no questions.");
  }
  return errors;
}

/** Is there anything worth planning a commit for yet? */
function hasContent() {
  if (st.images.length) return true;
  if (st.mode === "upload") return Boolean(st.upload);
  return st.index !== null || textEl.value.trim() !== "" || answerEl.value.trim() !== "";
}

function computePlan() {
  const errors = validate();
  const subject = currentSubject();
  const files = [];
  let qaChanged = false;
  let position = null;

  if (subject && hasContent()) {
    const built = buildList(st.bank.questions);
    position = built.position;
    // Compare as Markdown, so a file that only differs in formatting is not reported as changed.
    qaChanged = serializeBank(built.list) !== serializeBank(st.bank.questions);
    if (qaChanged) {
      const copy = structuredClone(st.data);
      const change = planBankChange(copy, subject.id, st.bank.path, built.list);
      if (change.path) files.push({ status: st.bank.path === change.path ? "M" : "A", path: change.path });
      for (const path of change.delete) files.push({ status: "D", path });
      if (serializeSubjects(copy) !== serializeSubjects(st.data)) files.push({ status: "M", path: SUBJECTS_PATH });
    }
  }
  for (const img of st.images) files.push({ status: "A", path: img.path });
  return { errors, subject, files, qaChanged, position };
}

function defaultMessage(plan) {
  const id = plan.subject ? plan.subject.id : "subject";
  if (!plan.qaChanged && st.images.length) return `Add image: ${id} ${st.images[0].path.split("/").pop().replace(/\.[^.]+$/, "")}`;
  if (st.mode === "upload") return `Upload Q&A (html): ${id} (${plural(st.upload ? st.upload.commit.questions.length : 0, "question")})`;
  if (st.index !== null) return `Update Q&A: ${id} Q${st.index + 1}`;
  return `Add Q&A: ${id} Q${plan.position || st.bank.questions.length + 1}`;
}

/* ---------- Rendering the side panels ---------- */

function refresh() {
  const plan = computePlan();
  $("saves-to").textContent = plan.subject ? qaPath(plan.subject, "md") : "—";

  const list = $("files");
  if (!plan.files.length) list.replaceChildren(el("li", "muted", "No changes yet."));
  else {
    list.replaceChildren(
      ...plan.files.map((f) => {
        const li = el("li");
        li.append(el("span", `tag-status tag-${f.status}`, f.status), el("span", "", f.path));
        return li;
      })
    );
  }

  if (!st.messageEdited) messageEl.value = defaultMessage(plan);
  renderProblems(plan.errors);
  syncYearChips();
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

/* ---------- Year quick-pick chips ---------- */

let yearChips = [];

function renderYearChips() {
  const thisYear = new Date().getFullYear();
  const years = [...new Set([thisYear, thisYear - 1, thisYear - 2, ...yearsIn(st.bank.questions)])].sort((a, b) => b - a).slice(0, 8);
  yearChips = years.map((y) => {
    const b = el("button", "chip-btn", String(y));
    b.type = "button";
    b.dataset.year = String(y);
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => {
      const have = parseYears(yearsEl.value).years;
      const next = have.includes(y) ? have.filter((v) => v !== y) : [...have, y].sort((a, b2) => a - b2);
      yearsEl.value = next.join(", ");
      markDirty();
    });
    return b;
  });
  $("year-chips").replaceChildren(...yearChips);
}

function syncYearChips() {
  const have = new Set(parseYears(yearsEl.value).years);
  for (const b of yearChips) b.setAttribute("aria-pressed", String(have.has(Number(b.dataset.year))));
}

/* ---------- The subject's questions ---------- */

/** Update everything that depends on the loaded question list. */
function afterBankLoaded() {
  $("chapter-list").replaceChildren(
    ...chaptersIn(st.bank.questions).map((c) => {
      const o = el("option");
      o.value = c;
      return o;
    })
  );
  renderYearChips();
  positionEl.max = String(maxPosition());
  if (st.index === null && !st.positionTouched) positionEl.value = String(st.bank.questions.length + 1);
  $("position-hint").textContent =
    st.index === null
      ? `From 1 to ${maxPosition()}. New questions go to the end unless you change this; the others move down.`
      : `Now Q${st.index + 1}. Change it to move the question; the ones in between shift.`;
  renderNotices();
  refresh();
}

async function loadBankFor(subject) {
  st.bankLoading = true;
  refresh();
  try {
    const bank = await loadRemoteBank(subject);
    if (currentSubject() && currentSubject().id !== subject.id) return; // the choice changed while loading
    st.bank = bank;
    st.parseNotes = bank.notes.slice();
  } catch (err) {
    showErrorBanner($("banner"), err instanceof GitHubError ? err.message : `Could not load the questions: ${err.message}`);
    st.bank = { path: null, questions: [], notes: [] };
  } finally {
    st.bankLoading = false;
  }
  afterBankLoaded();
}

function onSubjectChanged() {
  const subject = currentSubject();
  if (!subject) return;
  applyColor(document.documentElement, subject.color);
  if (st.upload) st.upload.preview = parseHtmlQA(st.upload.text, previewBase());
  if (st.mode === "upload") renderUpload();
  loadBankFor(subject);
}

/* ---------- Upload mode ---------- */

const formatSize = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

function previewBase() {
  const subject = currentSubject();
  return subject ? `../${subject.folder}` : "";
}

/** Parse an uploaded HTML file twice: clean for committing, with resolved image paths for the preview. */
function buildUpload(name, text) {
  return {
    name,
    size: new Blob([text]).size,
    text,
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
  const found = u.commit.questions.length;
  info.textContent = `${u.name} · ${formatSize(u.size)} · ${plural(found, "question")} found, to be added after the ${st.bank.questions.length} already in this subject`;

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
    const meta = el("div", "q-meta");
    meta.append(el("span", "q-marks", `${q.marks} marks`));
    if (q.chapter) meta.append(el("span", "tag tag-chapter", q.chapter));
    q.years.forEach((y) => meta.append(el("span", "tag tag-year", String(y))));
    text.append(el("h2", "q-text", q.question), meta);
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
  st.upload = buildUpload(file.name, await file.text());
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
  $("import-hint").hidden = write;
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
  const subject = currentSubject();
  const ext = IMAGE_TYPES[file.type];
  if (!subject) {
    status.textContent = "Choose a subject first, so the image is saved in the right folder.";
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
  const ref = `images/${base}.${ext}`;
  const path = `${subject.folder}/${ref}`;
  const base64 = await readBase64(file);
  st.images = st.images.filter((img) => img.path !== path).concat({ path, ref, base64, size: file.size });

  if (st.mode === "write") {
    const snippet = `![${base}](${ref})`;
    const at = st.answerFocused ? answerEl.selectionStart : answerEl.value.length;
    const end = st.answerFocused ? answerEl.selectionEnd : at;
    const lead = !st.answerFocused && answerEl.value && !answerEl.value.endsWith("\n") ? "\n\n" : "";
    answerEl.value = `${answerEl.value.slice(0, at)}${lead}${snippet}${answerEl.value.slice(end)}`;
    status.textContent = `Added ${ref} and inserted ${snippet} into the answer.`;
  } else {
    status.textContent = `Added ${ref}. Use <img src="${ref}" alt="${base}"> in your HTML.`;
  }
  markDirty();
});

/* ---------- Form events ---------- */

messageEl.addEventListener("input", () => (st.messageEdited = true));
answerEl.addEventListener("focus", () => (st.answerFocused = true));
positionEl.addEventListener("input", () => (st.positionTouched = true));

semesterEl.addEventListener("input", () => {
  fillSelect(subjectEl, subjectsOf(semesterEl.value).map((s) => [s.id, s.name]));
  onSubjectChanged();
  markDirty();
});
subjectEl.addEventListener("input", () => {
  onSubjectChanged();
  markDirty();
});
for (const node of [chapterEl, yearsEl, textEl, marksEl, positionEl, answerEl]) node.addEventListener("input", markDirty);

/* ---------- Commit and discard ---------- */

/** Clear the form for the next question after a successful add, keeping marks, chapter and years. */
function resetForNext() {
  st.index = null;
  st.orig = null;
  st.positionTouched = false;
  st.answerFocused = false;
  textEl.value = "";
  answerEl.value = "";
  $("page-title").textContent = "Add question";
  document.title = "Add question · MCA Notes Admin";
  history.replaceState(null, "", `?s=${encodeURIComponent(currentSubject().id)}`);
  afterBankLoaded();
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
    // Re-read the repository so the commit builds on the newest copies.
    const fresh = await loadRemoteSubjects();
    const subject = fresh.subjects.find((s) => s.id === plan.subject.id);
    if (!subject) throw new GitHubError("That subject no longer exists in subjects.json. Reload the page.", 0);
    const freshBank = await loadRemoteBank(subject);
    if (st.mode === "write" && st.index !== null) {
      const current = freshBank.questions[st.index];
      if (!current || current.question !== st.orig.question) {
        throw new GitHubError("This question was changed by someone else. Reload the page and try again.", 0);
      }
    }

    let put = {};
    let del = [];
    let built = { list: freshBank.questions, position: null };
    let path = freshBank.path;
    if (plan.qaChanged) {
      built = buildList(freshBank.questions);
      const change = planBankChange(fresh, subject.id, freshBank.path, built.list);
      put = change.put;
      del = change.delete;
      path = change.path;
    }
    for (const img of st.images) put[img.path] = { base64: img.base64 };
    const commit = await commitChanges({ message, put, delete: del });

    // The repository now matches the form: make it the new baseline.
    const wasImport = st.mode === "upload";
    const wasNew = st.index === null;
    st.data = fresh;
    st.bank = { path, questions: built.list, notes: [] };
    st.parseNotes = [];
    st.images = [];
    st.dirty = false;
    st.messageEdited = false;
    st.showProblems = false;

    const id = subject.id;
    const link = wasImport || !built.position
      ? { href: `../subject.html?s=${encodeURIComponent(id)}`, text: "View Q&A page" }
      : { href: `../subject.html?s=${encodeURIComponent(id)}#q${built.position}`, text: "View Q&A page" };
    showPushedBanner($("banner"), commit, link);

    if (wasImport) {
      st.upload = null;
      renderUpload();
      afterBankLoaded();
    } else if (wasNew) {
      resetForNext();
    } else {
      st.index = built.position - 1;
      st.orig = built.list[st.index];
      st.positionTouched = false;
      positionEl.value = String(built.position);
      $("page-title").textContent = `Edit Q${built.position}`;
      history.replaceState(null, "", `?s=${encodeURIComponent(id)}&q=${built.position}`);
      afterBankLoaded();
    }
    renderNotices();
    $("banner").scrollIntoView({ block: "nearest" });
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
  const subject = st.data.subjects.find((s) => s.id === params.get("s")) || st.data.subjects[0];
  const semesters = [...new Set(st.data.subjects.map((s) => s.semester))].sort();
  fillSelect(semesterEl, semesters.map((n) => [String(n), `Semester ${n}`]), subject.semester);
  fillSelect(subjectEl, subjectsOf(semesterEl.value).map((s) => [s.id, s.name]), subject.id);
  applyColor(document.documentElement, subject.color);

  st.bankLoading = true;
  try {
    st.bank = await loadRemoteBank(subject);
    st.parseNotes = st.bank.notes.slice();
  } catch (err) {
    showErrorBanner($("banner"), err instanceof GitHubError ? err.message : `Could not load the questions: ${err.message}`);
  }
  st.bankLoading = false;

  const wanted = params.get("q");
  if (wanted !== null) {
    const n = Number(wanted);
    if (Number.isInteger(n) && n >= 1 && n <= st.bank.questions.length) {
      st.index = n - 1;
      st.orig = st.bank.questions[st.index];
      const q = st.orig;
      textEl.value = q.question;
      marksEl.value = String(q.marks);
      chapterEl.value = q.chapter;
      yearsEl.value = q.years.join(", ");
      answerEl.value = q.answer;
      positionEl.value = String(n);
      lockFields(true);
      $("page-title").textContent = `Edit Q${n}`;
      document.title = `Edit Q${n} · ${subject.name} · MCA Notes Admin`;
    } else {
      st.parseNotes.push(`Question ${wanted} does not exist in ${subject.name}, so this adds a new question.`);
    }
  }

  afterBankLoaded();
  setMode("write");
  st.dirty = false;
}

init();
