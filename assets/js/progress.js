// Reading progress, stored in localStorage under one key.
//
// Shape: { chapters: { "<subjectId>/<NN>": [1, 2, 5] }, last: { s, ch, at } }
// A chapter entry lists the question numbers the reader has opened ("seen").

const KEY = "mca-notes-progress";

/** @returns {{chapters: Object<string, number[]>, last: ?{s: string, ch: number, at: number}}} */
function read() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    if (data && typeof data.chapters === "object" && data.chapters) return data;
  } catch {
    // Storage blocked or corrupt: fall through to an empty state.
  }
  return { chapters: {}, last: null };
}

function write(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage full or blocked: progress simply is not saved.
  }
}

const chapterKey = (subjectId, no) => `${subjectId}/${String(no).padStart(2, "0")}`;

/**
 * Question numbers seen in a chapter.
 * @param {string} subjectId
 * @param {number|string} no Chapter number.
 * @returns {number[]}
 */
export function getSeen(subjectId, no) {
  const seen = read().chapters[chapterKey(subjectId, no)];
  return Array.isArray(seen) ? seen : [];
}

/**
 * Record that a question has been opened, and remember the chapter as the last one read.
 * @param {string} subjectId
 * @param {number|string} no Chapter number.
 * @param {number} questionNo
 */
export function markSeen(subjectId, no, questionNo) {
  const data = read();
  const key = chapterKey(subjectId, no);
  const seen = new Set(data.chapters[key] || []);
  seen.add(questionNo);
  data.chapters[key] = [...seen].sort((a, b) => a - b);
  data.last = { s: subjectId, ch: Number(no), at: Date.now() };
  write(data);
}

/**
 * Remember the chapter as the last one opened, without marking any question.
 * @param {string} subjectId
 * @param {number|string} no
 */
export function setLast(subjectId, no) {
  const data = read();
  data.last = { s: subjectId, ch: Number(no), at: Date.now() };
  write(data);
}

/** @returns {?{s: string, ch: number, at: number}} The last chapter opened, if any. */
export function getLast() {
  return read().last;
}

/**
 * Status of one chapter: "none" (no Q&A file yet), "todo", "progress" or "done".
 * @param {string} subjectId
 * @param {{no: number, file: ?string, questions: number}} chapter
 * @returns {"none"|"todo"|"progress"|"done"}
 */
export function chapterStatus(subjectId, chapter) {
  if (!chapter.file || chapter.questions < 1) return "none";
  const seen = getSeen(subjectId, chapter.no).filter((n) => n <= chapter.questions).length;
  if (seen === 0) return "todo";
  return seen >= chapter.questions ? "done" : "progress";
}

/**
 * Totals for a subject, used by progress bars.
 * @param {{id: string, groups: Array<{chapters: Array}>}} subject
 * @returns {{done: number, total: number, percent: number}}
 *   `total` counts every chapter in the syllabus, not just those with a file.
 */
export function subjectProgress(subject) {
  const chapters = subject.groups.flatMap((g) => g.chapters);
  const done = chapters.filter((c) => chapterStatus(subject.id, c) === "done").length;
  const total = chapters.length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

/**
 * Forget all progress for one subject.
 * @param {string} subjectId
 */
export function resetSubject(subjectId) {
  const data = read();
  for (const key of Object.keys(data.chapters)) {
    if (key.startsWith(`${subjectId}/`)) delete data.chapters[key];
  }
  if (data.last && data.last.s === subjectId) data.last = null;
  write(data);
}
