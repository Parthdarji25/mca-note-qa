// Shared admin header and footer, so every admin page looks the same.

import { el } from "../dom.js";
import { getSession, clearToken } from "./auth.js";
import { REPO, BRANCH } from "../data.js";

const NAV = [
  ["index.html", "Connect"],
  ["chapters.html", "Chapters"],
  ["guide.html", "Format guide"]
];

/**
 * Fill #admin-header and #admin-footer.
 * @param {"index"|"chapters"|"editor"|"guide"} active Current page, for aria-current.
 */
export function renderShell(active) {
  const session = getSession();
  const repo = session ? session.repo : REPO;
  const branch = session ? session.branch : BRANCH;

  const header = document.getElementById("admin-header");
  if (header) {
    const inner = el("div", "container admin-inner");

    const brand = el("a", "brand");
    brand.href = "../index.html";
    brand.setAttribute("aria-label", "MCA Notes public site");
    const mark = el("span", "brand-mark", "#");
    mark.setAttribute("aria-hidden", "true");
    brand.append(mark, el("span", "brand-name", "MCA Notes"));

    const badge = el("span", "admin-badge", "ADMIN");
    const where = el("span", "admin-repo mono", session ? `${repo} · ${branch}` : "not connected");

    const nav = el("nav", "admin-nav");
    nav.setAttribute("aria-label", "Admin");
    for (const [href, label] of NAV) {
      const a = el("a", "", label);
      a.href = href;
      if (href.startsWith(active)) a.setAttribute("aria-current", "page");
      nav.append(a);
    }

    inner.append(brand, badge, where, nav);

    if (session) {
      const out = el("button", "admin-signout", "Sign out");
      out.type = "button";
      out.addEventListener("click", () => {
        clearToken();
        location.href = "index.html";
      });
      inner.append(out);
    }
    header.replaceChildren(inner);
  }

  const footer = document.getElementById("admin-footer");
  if (footer) {
    const inner = el("div", "container admin-footer-inner");

    const guides = el("div", "admin-footer-links");
    guides.append(el("span", "admin-footer-label", "Format guides:"));
    const links = [
      ["guide.html?tab=md", "Markdown (.md) syntax"],
      ["guide.html?tab=html", "HTML (.html) syntax"],
      ["guide.html#naming", "File naming rules"],
      ["guide.html#templates", "Download templates"]
    ];
    for (const [href, label] of links) {
      const a = el("a", "", label);
      a.href = href;
      guides.append(a);
    }

    const right = el("div", "admin-footer-links admin-footer-right");
    right.append(el("span", "mono", repo));
    const open = el("a", "", "Open repository");
    open.href = `https://github.com/${repo}`;
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    right.append(open);

    inner.append(guides, right);
    footer.replaceChildren(inner);
  }
}
