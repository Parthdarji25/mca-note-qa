// Small DOM helpers shared by the page scripts.

/**
 * Create an element with an optional class name and text content.
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 * @returns {HTMLElement}
 */
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Apply a subject's colours as CSS custom properties.
 * @param {HTMLElement} node
 * @param {{accent: string, tint: string, dark: string}} color
 */
export function applyColor(node, color) {
  node.style.setProperty("--accent", color.accent);
  node.style.setProperty("--tint", color.tint);
  node.style.setProperty("--accent-dark", color.dark);
}

/**
 * "1 chapter" / "2 chapters".
 * @param {number} n
 * @param {string} word
 * @returns {string}
 */
export function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
