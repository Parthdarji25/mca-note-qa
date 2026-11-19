// Phone menu: the header navigation collapses behind a button under 640px.

const toggle = document.getElementById("nav-toggle");
const nav = document.getElementById("site-nav");

/**
 * Open or close the menu and keep aria-expanded in step.
 * @param {boolean} open
 */
function setOpen(open) {
  nav.classList.toggle("is-open", open);
  toggle.setAttribute("aria-expanded", String(open));
}

if (toggle && nav) {
  toggle.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true"));

  // Close after choosing a link, on Escape, or when tapping outside the header.
  nav.addEventListener("click", (e) => {
    if (e.target.closest("a")) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
      setOpen(false);
      toggle.focus();
    }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".site-header")) setOpen(false);
  });
}
