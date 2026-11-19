// Reading and writing data/subjects.json and a subject's question file through the GitHub API.

import { getFile } from "./github.js";
import { parseMarkdownQA, parseHtmlQA, htmlAnswerToMarkdown, serializeMarkdownQA } from "../qa-parser.js";
import { qaPath } from "../data.js";

export const SUBJECTS_PATH = "data/subjects.json";

/**
 * Load the current data/subjects.json from the repository (not the cached site copy).
 * @returns {Promise<{subjects: Array<object>}>}
 */
export async function loadRemoteSubjects() {
  const file = await getFile(SUBJECTS_PATH);
  if (!file) throw new Error("data/subjects.json was not found in the repository.");
  return JSON.parse(file.text);
}

/**
 * Serialise subjects.json the same way every time (2-space indent, trailing newline).
 * @param {{subjects: Array<object>}} data
 * @returns {string}
 */
export function serializeSubjects(data) {
  return `${JSON.stringify(data, null, 2)}\n`;
}

/**
 * @typedef {object} BankQuestion A question as the admin edits it.
 * @property {string} question
 * @property {5|10} marks
 * @property {string} chapter Optional tag, "" when none.
 * @property {number[]} years Years asked, ascending.
 * @property {string} answer Markdown (HTML answers are kept as HTML inside the Markdown).
 */

/**
 * Load a subject's question file from the repository and parse it.
 * An .html file is read too; its answers come back as Markdown-safe HTML.
 * @param {{folder: string, file: ?string}} subject A subject from subjects.json.
 * @returns {Promise<{path: ?string, questions: BankQuestion[], notes: string[]}>}
 *   `path` is null when the subject has no file. `notes` lists problems found while reading.
 */
export async function loadRemoteBank(subject) {
  if (!subject.file) return { path: null, questions: [], notes: [] };
  const path = `${subject.folder}/${subject.file}`;
  const file = await getFile(path);
  if (!file) {
    return { path: null, questions: [], notes: [`The file ${path} is listed in subjects.json but was not found in the repository.`] };
  }
  const isHtml = /\.html?$/i.test(subject.file);
  const parsed = isHtml ? parseHtmlQA(file.text, "") : parseMarkdownQA(file.text, "");
  const questions = parsed.questions.map((q) => ({
    question: q.question,
    marks: q.marks,
    chapter: q.chapter,
    years: q.years,
    answer: isHtml ? htmlAnswerToMarkdown(q.answerHtml) : q.answerMd
  }));
  const notes = [
    ...parsed.errors.map((e) => `${e} That question was skipped and will be dropped if you save.`),
    ...parsed.warnings
  ];
  if (isHtml && questions.length) notes.push(`${subject.file} is an .html file. Saving converts it to a Markdown file and removes the .html file in the same commit.`);
  return { path, questions, notes };
}

/**
 * Write a question list as the Markdown file contents.
 * @param {BankQuestion[]} questions
 * @returns {string}
 */
export function serializeBank(questions) {
  return serializeMarkdownQA(questions.map((q) => ({ ...q, answerMd: q.answer })));
}

/**
 * Work out the commit that makes the repository hold `list` as a subject's questions,
 * and update the subject in `data` (subjects.json) so `file` and `questions` match.
 * An empty list deletes the file and marks the subject as having no questions yet.
 * @param {{subjects: Array<object>}} data subjects.json contents. Mutated.
 * @param {string} subjectId
 * @param {?string} currentPath Path of the question file in the repository now, or null.
 * @param {BankQuestion[]} list The questions the subject should have after the commit.
 * @returns {{put: Object<string, string>, delete: string[], path: ?string}}
 *   `put` and `delete` go straight to commitChanges(); `path` is the question file afterwards (null if deleted).
 */
export function planBankChange(data, subjectId, currentPath, list) {
  const subject = data.subjects.find((s) => s.id === subjectId);
  const put = {};
  const del = [];
  let path = null;
  if (list.length) {
    path = qaPath(subject, "md");
    put[path] = serializeBank(list);
    if (currentPath && currentPath !== path) del.push(currentPath);
    subject.file = path.split("/").pop();
    subject.questions = list.length;
  } else {
    if (currentPath) del.push(currentPath);
    subject.file = null;
    subject.questions = 0;
  }
  put[SUBJECTS_PATH] = serializeSubjects(data);
  return { put, delete: del, path };
}

/**
 * Chapter tags used in a list of questions, for autocomplete.
 * @param {BankQuestion[]} questions
 * @returns {string[]} Unique, sorted.
 */
export function chaptersIn(questions) {
  return [...new Set(questions.map((q) => q.chapter).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * Years used in a list of questions.
 * @param {BankQuestion[]} questions
 * @returns {number[]} Unique, newest first.
 */
export function yearsIn(questions) {
  return [...new Set(questions.flatMap((q) => q.years))].sort((a, b) => b - a);
}
