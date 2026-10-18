// Reading and writing data/subjects.json through the GitHub API.

import { getFile } from "./github.js";

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
 * Find a chapter by number.
 * @param {{groups: Array<{chapters: Array<object>}>}} subject
 * @param {number} no
 * @returns {?object}
 */
export function findChapter(subject, no) {
  return subject.groups.flatMap((g) => g.chapters).find((c) => c.no === no) || null;
}
