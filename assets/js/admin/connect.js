// admin/index.html: sign in with a repository, branch and token.

import { getSession, saveSession, clearToken } from "./auth.js";
import { getRepo, getBranch, GitHubError } from "./github.js";
import { renderShell } from "./shell.js";

const form = document.getElementById("connect-form");
const connectPanel = document.getElementById("connect-panel");
const connectedPanel = document.getElementById("connected-panel");
const status = document.getElementById("status");
const button = document.getElementById("connect-btn");

function showError(message) {
  status.textContent = message;
  status.hidden = false;
}

function showConnected(session) {
  document.getElementById("c-repo").textContent = session.repo;
  document.getElementById("c-branch").textContent = session.branch;
  document.getElementById("c-kept").textContent = session.persist ? "On this device" : "Until this tab closes";
  connectPanel.hidden = true;
  connectedPanel.hidden = false;
  status.hidden = true;
}

function showSignIn() {
  connectPanel.hidden = false;
  connectedPanel.hidden = true;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  status.hidden = true;

  const repo = form.repo.value.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "").replace(/\/$/, "");
  const branch = form.branch.value.trim();
  const token = form.token.value.trim();
  const persist = form.persist.value === "device";

  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return showError("Enter the repository as owner/repo, for example Parthdarji25/mca-note-qa.");
  if (!branch) return showError("Enter the branch name, for example main.");
  if (!token) return showError("Paste your personal access token.");

  const session = { repo, branch, token, persist };
  button.disabled = true;
  button.textContent = "Checking…";
  try {
    const info = await getRepo(session);
    await getBranch(session);
    if (info.permissions && info.permissions.push === false) {
      throw new GitHubError('This token can read the repository but not write to it. Give it "Contents: Read and write".', 403);
    }
    saveSession(session);
    form.token.value = "";
    renderShell("index");
    showConnected(session);
  } catch (err) {
    showError(err instanceof GitHubError ? err.message : "Something went wrong while checking the token.");
  } finally {
    button.disabled = false;
    button.textContent = "Connect";
  }
});

document.getElementById("signout-btn").addEventListener("click", () => {
  clearToken();
  renderShell("index");
  showSignIn();
});

renderShell("index");
const existing = getSession();
if (existing) {
  form.repo.value = existing.repo;
  form.branch.value = existing.branch;
  showConnected(existing);
}
