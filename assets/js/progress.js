// Reading progress, stored in localStorage under one key.
//
// Shape: { subjects: { "<subjectId>": ["k1", "k2"] }, last: { s, at } }
// A subject entry lists the questions the reader has opened ("seen"). A question is identified by
// a short hash of its text, so progress survives when questions are added, removed or reordered.

const KEY = "mca-notes-progress";

/** @returns {{subjects: Object<string, string[]>, last: ?{s: string, at: number}}} */
function read() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    // Data saved by the old chapter-based site has no "subjects" key and is ignored.
    if (data && typeof data.subjects === "object" && data.subjects) return data;
  } catch {
    // Storage blocked or corrupt: fall through to an empty state.
  }
  return { subjects: {}, last: null };
}

function write(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage full or blocked: progress simply is not saved.
  }
}

/**
 * Stable id of a question, derived from its text (FNV-1a hash of the lower-cased, single-spaced text).
 * @param {string} text The question text.
 * @returns {string} e.g. "3f2a91bc"
 */
export function questionKey(text) {
  const s = String(text).toLowerCase().replace(/\s+/g, " ").trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Question keys seen in a subject.
 * @param {string} subjectId
 * @returns {Set<string>}
 */
export function getSeen(subjectId) {
  const seen = read().subjects[subjectId];
  return new Set(Array.isArray(seen) ? seen : []);
}

/**
 * Record that a question has been opened, and remember the subject as the last one read.
 * @param {string} subjectId
 * @param {string} key Result of questionKey().
 */
export function markSeen(subjectId, key) {
  const data = read();
  const seen = new Set(data.subjects[subjectId] || []);
  seen.add(key);
  data.subjects[subjectId] = [...seen];
  data.last = { s: subjectId, at: Date.now() };
  write(data);
}

/**
 * Remember the subject as the last one opened, without marking any question.
 * @param {string} subjectId
 */
export function setLast(subjectId) {
  const data = read();
  data.last = { s: subjectId, at: Date.now() };
  write(data);
}

/** @returns {?{s: string, at: number}} The last subject opened, if any. */
export function getLast() {
  return read().last;
}

/**
 * Drop seen keys that no longer match a question (the question was edited or deleted),
 * so the "seen" count never exceeds the number of questions.
 * @param {string} subjectId
 * @param {Iterable<string>} validKeys Keys of the questions that exist now.
 */
export function pruneSeen(subjectId, validKeys) {
  const data = read();
  const current = data.subjects[subjectId];
  if (!Array.isArray(current)) return;
  const valid = new Set(validKeys);
  const kept = current.filter((k) => valid.has(k));
  if (kept.length === current.length) return;
  data.subjects[subjectId] = kept;
  write(data);
}

/**
 * Totals for a subject, used by progress bars.
 * @param {{id: string, questions: number}} subject `questions` comes from subjects.json.
 * @returns {{seen: number, total: number, percent: number}}
 */
export function subjectProgress(subject) {
  const total = subject.file ? subject.questions : 0;
  const seen = Math.min(getSeen(subject.id).size, total);
  return { seen, total, percent: total ? Math.round((seen / total) * 100) : 0 };
}
