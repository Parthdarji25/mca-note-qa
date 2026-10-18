// Shared data helpers: load the syllabus and build file paths.

/** GitHub repository (owner/name) and branch the site is published from. */
export const REPO = "Parthdarji25/mca-note-qa";
export const BRANCH = "main";

/**
 * Fetch and return the list of subjects from data/subjects.json.
 * Pass a base path ("../" from /admin/) when calling from a subfolder.
 * @param {string} [base=""] Path prefix to the site root.
 * @returns {Promise<Array<object>>} The subjects array.
 */
export async function loadSubjects(base = "") {
  const res = await fetch(`${base}data/subjects.json`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Could not load subjects.json (HTTP ${res.status})`);
  const data = await res.json();
  return data.subjects;
}

/**
 * Turn text into a lowercase, hyphen-joined slug.
 * "Authentication – I" -> "authentication-i"
 * @param {string} text
 * @returns {string}
 */
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Zero-pad a number to two digits.
 * @param {number|string} n
 * @returns {string} e.g. "02"
 */
export function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * Build the repo path of a chapter's Q&A file.
 * @param {{semester: number, id: string}} subject
 * @param {number|string} no Chapter number.
 * @param {string} title Chapter title.
 * @param {"md"|"html"} [ext="md"]
 * @returns {string} e.g. "qa/sem-2/information-security/ch02-cryptography.md"
 */
export function chapterPath(subject, no, title, ext = "md") {
  return `qa/sem-${subject.semester}/${subject.id}/ch${pad2(no)}-${slugify(title)}.${ext}`;
}

// Tiny self-check, logged once on load.
if (slugify("Authentication – I") === "authentication-i") {
  console.log("data.js self-check passed");
} else {
  console.error("data.js self-check FAILED: slugify(\"Authentication – I\") =", slugify("Authentication – I"));
}
