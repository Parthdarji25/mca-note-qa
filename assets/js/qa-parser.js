// Q&A parsing and sanitising.
//
// Both parsers return a result object, never throw:
//   {
//     questions: [{ no, question, marks, answerHtml }],  // answerHtml is sanitised
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
const ABSOLUTE_URL = /^([a-z][a-z0-9+.-]*:|\/\/|\/|#)/i;
const EXTERNAL_URL = /^https?:\/\//i;

let currentBase = "";
let hooksInstalled = false;

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
 * @param {string} [baseFolder] Folder of the chapter file, for image paths.
 * @returns {{questions: Array<{no: number, question: string, marks: 5|10, answerHtml: string, answerMd: string}>, errors: string[], warnings: string[], removed: string[]}}
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
      const answerMd = body.slice(first + 1).join("\n").trim();
      if (!answerMd) warnings.push(`${label} has no answer text.`);
      const { html, removed: gone } = sanitizeAnswer(marked.parse(answerMd, { gfm: true }), baseFolder);
      gone.forEach((g) => removed.add(g));
      sourceNos.push(h.srcNo);
      questions.push({ no: questions.length + 1, question: h.title, marks, answerHtml: html, answerMd });
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
 * @param {string} [baseFolder] Folder of the chapter file, for image paths.
 * @returns {{questions: Array<{no: number, question: string, marks: 5|10, answerHtml: string}>, errors: string[], warnings: string[], removed: string[]}}
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
      questions.push({ no: questions.length + 1, question: heading.textContent.trim(), marks: Number(marksRaw), answerHtml: html });
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
 * Write questions in the exact Markdown file format of section 5.
 * @param {Array<{question: string, marks: number, answerMd: string}>} questions In display order.
 * @returns {string} File contents ending with a newline.
 */
export function serializeMarkdownQA(questions) {
  const blocks = questions.map((q, i) => {
    const title = q.question.replace(/\s+/g, " ").trim();
    const answer = q.answerMd.replace(/\r\n?/g, "\n").trim();
    return `## Q${i + 1}. ${title}\nMarks: ${q.marks}\n\n${answer}`;
  });
  return `${blocks.join("\n\n")}\n`;
}

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Write questions in the HTML file format of section 5. `answerHtml` must already be sanitised
 * and parsed WITHOUT a base folder, so image paths stay relative to the chapter file.
 * @param {Array<{question: string, marks: number, answerHtml: string}>} questions
 * @returns {string} File contents ending with a newline.
 */
export function serializeHtmlQA(questions) {
  const blocks = questions.map(
    (q) =>
      `<section class="question" data-marks="${q.marks}">\n  <h2>${escapeHtml(q.question)}</h2>\n  <div class="answer">\n${q.answerHtml}\n  </div>\n</section>`
  );
  return `${blocks.join("\n\n")}\n`;
}
