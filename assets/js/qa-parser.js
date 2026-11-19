// Q&A parsing and sanitising.
//
// A Q&A file holds all the questions of one subject, in order. Each question has marks (5 or 10)
// and two optional tags: a chapter (free text) and the years it was asked.
//
// Both parsers return a result object, never throw:
//   {
//     questions: [{ no, question, marks, chapter, years, answerHtml }],  // answerHtml is sanitised
//     errors:    string[],  // problems that dropped a question or the whole file
//     warnings:  string[],  // problems that were repaired (e.g. renumbering)
//     removed:   string[]   // unsafe content stripped by the sanitiser
//   }
//
// Needs the global `marked` and `DOMPurify` (loaded from a CDN by the page).

/** Tags allowed in answers (section 5 of the spec). */
export const ALLOWED_TAGS = [
  "p", "h3", "h4", "strong", "em", "b", "i", "u", "br",
  "ul", "ol", "li",
  "table", "thead", "tbody", "tr", "th", "td",
  "pre", "code", "blockquote",
  "img", "a", "sup", "sub", "hr"
];

/** Attributes allowed in answers. `class` is further limited to blockquote.note by a hook. */
export const ALLOWED_ATTR = ["href", "src", "alt", "title", "class", "colspan", "rowspan"];

const QUESTION_HEADING = /^## Q(\d+)\.\s+(.+)$/;
const MARKS_LINE = /^Marks:\s*(5|10)\s*$/;
const META_LINE = /^(Chapter|Years?):[ \t]*(.*)$/i;
const ABSOLUTE_URL = /^([a-z][a-z0-9+.-]*:|\/\/|\/|#)/i;
const EXTERNAL_URL = /^https?:\/\//i;

/** Longest chapter tag that is kept. */
export const MAX_CHAPTER_LENGTH = 80;
/** Years outside this range are rejected as typos. */
export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;

let currentBase = "";
let hooksInstalled = false;

/**
 * Tidy a chapter tag: single spaces, no line breaks, capped length.
 * @param {*} text
 * @returns {string} "" when there is no tag.
 */
export function normalizeChapter(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_CHAPTER_LENGTH);
}

/**
 * Read a list of years such as "2024, 2025 2026".
 * @param {string} text Separated by commas, semicolons or spaces.
 * @returns {{years: number[], invalid: string[]}} `years` is unique and ascending; `invalid` lists rejected entries.
 */
export function parseYears(text) {
  const years = [];
  const invalid = [];
  for (const part of String(text ?? "").split(/[\s,;]+/).filter(Boolean)) {
    const n = Number(part);
    if (/^\d{4}$/.test(part) && n >= MIN_YEAR && n <= MAX_YEAR) {
      if (!years.includes(n)) years.push(n);
    } else {
      invalid.push(part);
    }
  }
  years.sort((a, b) => a - b);
  return { years, invalid };
}

/**
 * Join a folder and a relative path, resolving "." and ".." segments.
 * A leading ".." that cannot be resolved is kept so "../qa/x" stays relative.
 * @param {string} base
 * @param {string} src
 * @returns {string}
 */
export function resolvePath(base, src) {
  const out = [];
  for (const part of `${base}/${src}`.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === ".." && out.length && out[out.length - 1] !== "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function installHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    const tag = node.tagName;
    // Only blockquote.note may keep a class; "> **Remember:**" becomes a note.
    if (tag === "BLOCKQUOTE") {
      const isNote = node.classList.contains("note") || /^\s*remember:/i.test(node.textContent);
      node.removeAttribute("class");
      if (isNote) node.setAttribute("class", "note");
    } else if (node.hasAttribute && node.hasAttribute("class")) {
      node.removeAttribute("class");
    }
    if (tag === "A" && node.hasAttribute("href") && EXTERNAL_URL.test(node.getAttribute("href"))) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
    if (tag === "IMG" && node.hasAttribute("src")) {
      const src = node.getAttribute("src");
      if (!ABSOLUTE_URL.test(src) && currentBase) node.setAttribute("src", resolvePath(currentBase, src));
      node.setAttribute("loading", "lazy");
    }
  });
}

function describeRemoved(entry) {
  if (entry.element && entry.element.nodeName && entry.element.nodeType === 1) {
    if (/^(body|head|html)$/i.test(entry.element.nodeName)) return null; // parser wrapper, not author content
    return `<${entry.element.nodeName.toLowerCase()}> element`;
  }
  if (entry.attribute) {
    const from = entry.from && entry.from.nodeName ? ` on <${entry.from.nodeName.toLowerCase()}>` : "";
    return `${entry.attribute.name} attribute${from}`;
  }
  return null;
}

/**
 * Sanitise answer HTML with the explicit allow-list.
 * @param {string} html Untrusted HTML.
 * @param {string} [baseFolder] Folder that relative image paths resolve against.
 * @returns {{html: string, removed: string[]}} Safe HTML and descriptions of what was stripped.
 */
export function sanitizeAnswer(html, baseFolder = "") {
  installHooks();
  currentBase = baseFolder;
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false
  });
  const removed = DOMPurify.removed.map(describeRemoved).filter(Boolean);
  return { html: clean, removed };
}

function librariesMissing() {
  return typeof marked === "undefined" || typeof DOMPurify === "undefined";
}

function failure(message) {
  return { questions: [], errors: [message], warnings: [], removed: [] };
}

function renumberWarnings(sourceNos, warnings) {
  sourceNos.forEach((n, i) => {
    if (n !== null && n !== i + 1) {
      warnings.push(`Question numbers are not in order: Q${n} appears at position ${i + 1}. Questions are renumbered by position.`);
    }
  });
}

/**
 * Parse a Markdown Q&A file.
 * @param {string} text File contents.
 * @param {string} [baseFolder] Folder of the Q&A file, for image paths.
 * @returns {{questions: Array<{no: number, question: string, marks: 5|10, chapter: string, years: number[], answerHtml: string, answerMd: string}>, errors: string[], warnings: string[], removed: string[]}}
 *   `answerMd` is the answer's original Markdown, kept so the admin editor can edit and save it.
 */
export function parseMarkdownQA(text, baseFolder = "") {
  if (librariesMissing()) return failure("The Markdown or sanitiser library did not load. Check your connection and reload.");
  try {
    const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
    const heads = [];
    let fence = null;
    lines.forEach((line, i) => {
      const f = line.match(/^\s{0,3}(```|~~~)/);
      if (f) {
        if (!fence) fence = f[1];
        else if (f[1] === fence) fence = null;
        return;
      }
      if (fence) return;
      const m = line.match(QUESTION_HEADING);
      if (m) heads.push({ line: i, srcNo: Number(m[1]), title: m[2].trim() });
    });
    if (!heads.length) {
      return failure("No questions found. Each question must start with a line like \"## Q1. Your question\".");
    }

    const questions = [];
    const errors = [];
    const warnings = [];
    const removed = new Set();
    const sourceNos = [];

    heads.forEach((h, idx) => {
      const end = idx + 1 < heads.length ? heads[idx + 1].line : lines.length;
      const body = lines.slice(h.line + 1, end);
      const first = body.findIndex((l) => l.trim() !== "");
      const label = `Q${h.srcNo}`;
      if (first === -1 || !MARKS_LINE.test(body[first].trim())) {
        errors.push(`${label} ("${h.title}"): the line after the question must be "Marks: 5" or "Marks: 10".`);
        return;
      }
      const marks = Number(body[first].trim().match(MARKS_LINE)[1]);

      // Optional "Chapter:" and "Years:" lines directly under the marks line (no blank line between).
      let chapter = "";
      let years = [];
      let next = first + 1;
      for (; next < body.length; next++) {
        const meta = body[next].trim().match(META_LINE);
        if (!meta) break;
        if (meta[1].toLowerCase() === "chapter") {
          chapter = normalizeChapter(meta[2]);
        } else {
          const parsed = parseYears(meta[2]);
          years = parsed.years;
          parsed.invalid.forEach((bad) => warnings.push(`${label}: "${bad}" is not a valid year (use four digits, ${MIN_YEAR}–${MAX_YEAR}) and was ignored.`));
        }
      }

      const answerMd = body.slice(next).join("\n").trim();
      if (!answerMd) warnings.push(`${label} has no answer text.`);
      const { html, removed: gone } = sanitizeAnswer(marked.parse(answerMd, { gfm: true }), baseFolder);
      gone.forEach((g) => removed.add(g));
      sourceNos.push(h.srcNo);
      questions.push({ no: questions.length + 1, question: h.title, marks, chapter, years, answerHtml: html, answerMd });
    });

    renumberWarnings(sourceNos, warnings);
    return { questions, errors, warnings, removed: [...removed] };
  } catch (err) {
    return failure(`Could not read the Markdown file: ${err.message}`);
  }
}

/**
 * Parse an HTML Q&A file.
 * @param {string} text File contents.
 * @param {string} [baseFolder] Folder of the Q&A file, for image paths.
 * @returns {{questions: Array<{no: number, question: string, marks: 5|10, chapter: string, years: number[], answerHtml: string}>, errors: string[], warnings: string[], removed: string[]}}
 */
export function parseHtmlQA(text, baseFolder = "") {
  if (typeof DOMPurify === "undefined") return failure("The sanitiser library did not load. Check your connection and reload.");
  try {
    const doc = new DOMParser().parseFromString(String(text), "text/html");
    const sections = [...doc.querySelectorAll("section.question")];
    if (!sections.length) {
      return failure("No questions found. Each question must be a <section class=\"question\" data-marks=\"5\"> element.");
    }

    const questions = [];
    const errors = [];
    const warnings = [];
    const removed = new Set();

    // Dangerous content anywhere in the file, even outside answers.
    doc.querySelectorAll("script, style, iframe, object, embed, form").forEach((n) => removed.add(`<${n.localName}> element`));
    doc.querySelectorAll("*").forEach((n) => {
      for (const attr of n.attributes) {
        if (/^on/i.test(attr.name)) removed.add(`${attr.name.toLowerCase()} attribute on <${n.localName}>`);
        else if (attr.name === "style") removed.add(`style attribute on <${n.localName}>`);
      }
    });

    sections.forEach((section, i) => {
      const label = `Question ${i + 1}`;
      const heading = section.querySelector("h2");
      const answer = section.querySelector(".answer");
      const marksRaw = (section.getAttribute("data-marks") || "").trim();
      if (!heading || !heading.textContent.trim()) {
        errors.push(`${label}: missing the <h2> question text.`);
        return;
      }
      if (marksRaw !== "5" && marksRaw !== "10") {
        errors.push(`${label}: data-marks must be 5 or 10 (found "${marksRaw || "nothing"}").`);
        return;
      }
      if (!answer) {
        errors.push(`${label}: missing the <div class="answer"> element.`);
        return;
      }
      const { html, removed: gone } = sanitizeAnswer(answer.innerHTML, baseFolder);
      gone.forEach((g) => removed.add(g));
      if (!answer.textContent.trim() && !answer.querySelector("img")) warnings.push(`${label} has no answer text.`);

      const parsedYears = parseYears(section.getAttribute("data-years"));
      parsedYears.invalid.forEach((bad) => warnings.push(`${label}: "${bad}" is not a valid year (use four digits, ${MIN_YEAR}–${MAX_YEAR}) and was ignored.`));
      questions.push({
        no: questions.length + 1,
        question: heading.textContent.trim(),
        marks: Number(marksRaw),
        chapter: normalizeChapter(section.getAttribute("data-chapter")),
        years: parsedYears.years,
        answerHtml: html
      });
    });

    return { questions, errors, warnings, removed: [...removed] };
  } catch (err) {
    return failure(`Could not read the HTML file: ${err.message}`);
  }
}

/**
 * Parse a Q&A file, choosing the parser from the file name.
 * @param {string} fileName Name or path ending in .md, .html or .htm.
 * @param {string} text
 * @param {string} [baseFolder]
 */
export function parseQA(fileName, text, baseFolder = "") {
  return /\.html?$/i.test(fileName) ? parseHtmlQA(text, baseFolder) : parseMarkdownQA(text, baseFolder);
}

/**
 * Write questions in the Markdown file format (see the format guide).
 * `Chapter:` and `Years:` lines are written only when the question has them.
 * @param {Array<{question: string, marks: number, chapter?: string, years?: number[], answerMd: string}>} questions In display order.
 * @returns {string} File contents ending with a newline.
 */
export function serializeMarkdownQA(questions) {
  const blocks = questions.map((q, i) => {
    const title = q.question.replace(/\s+/g, " ").trim();
    const answer = q.answerMd.replace(/\r\n?/g, "\n").trim();
    const chapter = normalizeChapter(q.chapter);
    const years = [...new Set(q.years || [])].sort((a, b) => a - b);
    const meta = [`Marks: ${q.marks}`];
    if (chapter) meta.push(`Chapter: ${chapter}`);
    if (years.length) meta.push(`Years: ${years.join(", ")}`);
    return `## Q${i + 1}. ${title}\n${meta.join("\n")}\n\n${answer}`;
  });
  return `${blocks.join("\n\n")}\n`;
}

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Write questions in the HTML file format. `answerHtml` must already be sanitised
 * and parsed WITHOUT a base folder, so image paths stay relative to the Q&A file.
 * @param {Array<{question: string, marks: number, chapter?: string, years?: number[], answerHtml: string}>} questions
 * @returns {string} File contents ending with a newline.
 */
export function serializeHtmlQA(questions) {
  const blocks = questions.map((q) => {
    const chapter = normalizeChapter(q.chapter);
    const years = [...new Set(q.years || [])].sort((a, b) => a - b);
    const attrs = [`data-marks="${q.marks}"`];
    if (chapter) attrs.push(`data-chapter="${escapeHtml(chapter)}"`);
    if (years.length) attrs.push(`data-years="${years.join(",")}"`);
    return `<section class="question" ${attrs.join(" ")}>\n  <h2>${escapeHtml(q.question)}</h2>\n  <div class="answer">\n${q.answerHtml}\n  </div>\n</section>`;
  });
  return `${blocks.join("\n\n")}\n`;
}

/**
 * Turn sanitised answer HTML into text that is safe to store in a Markdown file.
 * Markdown passes HTML through, but an HTML block ends at a blank line and a line indented by four
 * spaces becomes a code block. So outside <pre>, blank lines and indentation are removed; inside
 * <pre> (which keeps its own whitespace) each blank line is written as an &#10; entity, which
 * renders as the same line break. The result renders the same as the original HTML.
 * @param {string} html Sanitised answer HTML, parsed without a base folder.
 * @returns {string}
 */
export function htmlAnswerToMarkdown(html) {
  return String(html)
    .split(/(<pre[\s\S]*?<\/pre>)/i)
    .map((part, i) => {
      if (i % 2) {
        // Inside <pre>: k line breaks in a row (k-1 blank lines) become k-1 entities and one real break.
        return part.replace(/\n(?:[ \t]*\n)+/g, (run) => {
          const breaks = run.split("\n").length - 1;
          return `${"&#10;".repeat(breaks - 1)}\n`;
        });
      }
      return part.replace(/[ \t]+$/gm, "").replace(/^[ \t]+/gm, "").replace(/\n{2,}/g, "\n");
    })
    .join("")
    .trim();
}
