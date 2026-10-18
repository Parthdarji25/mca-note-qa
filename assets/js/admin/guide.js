// admin/guide.html: Markdown | HTML tabs. Linkable with ?tab=md or ?tab=html.

import { renderShell } from "./shell.js";

const tabs = { md: document.getElementById("tab-md"), html: document.getElementById("tab-html") };
const panels = { md: document.getElementById("panel-md"), html: document.getElementById("panel-html") };

/**
 * Show one tab.
 * @param {"md"|"html"} name
 * @param {boolean} [updateUrl=true] Also write ?tab= to the address bar.
 */
function select(name, updateUrl = true) {
  for (const key of Object.keys(tabs)) {
    tabs[key].setAttribute("aria-selected", String(key === name));
    tabs[key].tabIndex = key === name ? 0 : -1;
    panels[key].hidden = key !== name;
  }
  if (updateUrl) history.replaceState(null, "", `?tab=${name}${location.hash}`);
}

for (const [name, tab] of Object.entries(tabs)) {
  tab.addEventListener("click", () => select(name));
  tab.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const other = name === "md" ? "html" : "md";
    select(other);
    tabs[other].focus();
  });
}

renderShell("guide");
select(new URLSearchParams(location.search).get("tab") === "html" ? "html" : "md", false);

// Jump to #naming / #templates after the shell is drawn.
if (location.hash) {
  const target = document.getElementById(location.hash.slice(1));
  if (target) target.scrollIntoView();
}
