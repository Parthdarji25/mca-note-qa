// Minimal GitHub REST client for the admin area.
//
// Every write goes through commitChanges(), which makes ONE commit with the Git Data API
// so a Q&A file and data/subjects.json always change together.
// The token is only ever sent in the Authorization header; it is never logged.

import { getSession } from "./auth.js";

const API = "https://api.github.com";

/** Error with the HTTP status and a message that is safe to show to the user. */
export class GitHubError extends Error {
  /**
   * @param {string} message
   * @param {number} [status] HTTP status, or 0 for network failures.
   */
  constructor(message, status = 0) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
  }
}

/** Turn a failed response into a readable message. */
function describeFailure(status, apiMessage) {
  switch (status) {
    case 401:
      return "GitHub rejected the token (401). It may be wrong, expired or revoked. Create a new token and sign in again.";
    case 403:
      return `GitHub refused the request (403). The token needs "Contents: Read and write" on this repository, or you hit a rate limit.${apiMessage ? ` GitHub says: ${apiMessage}` : ""}`;
    case 404:
      return "GitHub could not find that repository, branch or file (404). Check the name, or that the token has access to this repository.";
    default:
      return `GitHub returned an error (${status}).${apiMessage ? ` ${apiMessage}` : ""}`;
  }
}

function currentSession(session) {
  const s = session || getSession();
  if (!s) throw new GitHubError("You are not signed in.", 401);
  return s;
}

/**
 * Call the GitHub API.
 * @param {{repo: string, token: string}} session
 * @param {string} method
 * @param {string} path Path after the API base, starting with "/".
 * @param {object} [body] JSON body.
 * @returns {Promise<any>} Parsed JSON (null for 204).
 */
async function request(session, method, path, body) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${session.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new GitHubError("Could not reach GitHub. Check your internet connection.", 0);
  }
  let data = null;
  if (res.status !== 204) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  }
  if (!res.ok) throw new GitHubError(describeFailure(res.status, data && data.message), res.status);
  return data;
}

const repoPath = (s) => `/repos/${s.repo}`;
/** Encode each path segment but keep the slashes. */
const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

/**
 * UTF-8 text to base64.
 * @param {string} text
 * @returns {string}
 */
export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * Base64 to UTF-8 text.
 * @param {string} b64 Base64, newlines allowed.
 * @returns {string}
 */
export function fromBase64(b64) {
  const binary = atob(b64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Read the repository (also used to validate a token).
 * @param {object} [session] Defaults to the stored sign-in.
 * @returns {Promise<object>} GitHub repository object.
 */
export function getRepo(session) {
  const s = currentSession(session);
  return request(s, "GET", repoPath(s));
}

/**
 * Check that the branch exists.
 * @param {object} [session]
 * @returns {Promise<object>} GitHub branch object.
 */
export function getBranch(session) {
  const s = currentSession(session);
  return request(s, "GET", `${repoPath(s)}/branches/${encodeURIComponent(s.branch)}`);
}

/**
 * Read a text file from the branch.
 * @param {string} path Repo path, e.g. "data/subjects.json".
 * @param {object} [session]
 * @returns {Promise<?{text: string, sha: string}>} null when the file does not exist.
 */
export async function getFile(path, session) {
  const s = currentSession(session);
  try {
    const data = await request(s, "GET", `${repoPath(s)}/contents/${encodePath(path)}?ref=${encodeURIComponent(s.branch)}`);
    if (Array.isArray(data) || data.type !== "file") throw new GitHubError(`${path} is not a file.`, 0);
    if (data.content) return { text: fromBase64(data.content), sha: data.sha };
    // Files over 1 MB come back without content: read the blob instead.
    const blob = await request(s, "GET", `${repoPath(s)}/git/blobs/${data.sha}`);
    return { text: fromBase64(blob.content), sha: data.sha };
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) return null;
    throw err;
  }
}

/**
 * List the commits that touched a path.
 * @param {string} path Folder or file, e.g. "qa".
 * @param {number} [count=5]
 * @param {object} [session]
 * @returns {Promise<Array<{sha: string, short: string, message: string, date: string, url: string}>>}
 */
export async function listCommits(path, count = 5, session) {
  const s = currentSession(session);
  const q = `path=${encodeURIComponent(path)}&sha=${encodeURIComponent(s.branch)}&per_page=${count}`;
  const list = await request(s, "GET", `${repoPath(s)}/commits?${q}`);
  return list.map((c) => ({
    sha: c.sha,
    short: c.sha.slice(0, 7),
    message: c.commit.message.split("\n")[0],
    date: c.commit.committer ? c.commit.committer.date : c.commit.author.date,
    url: c.html_url
  }));
}

/**
 * One atomic attempt: ref -> commit -> blobs -> tree -> commit -> update ref.
 * @returns {Promise<{sha: string, message: string}>}
 */
async function attemptCommit(s, message, put, remove) {
  const base = repoPath(s);
  const ref = await request(s, "GET", `${base}/git/ref/heads/${encodeURIComponent(s.branch)}`);
  const parentSha = ref.object.sha;
  const parent = await request(s, "GET", `${base}/git/commits/${parentSha}`);

  const entries = [];
  for (const [path, value] of Object.entries(put)) {
    const content = typeof value === "string" ? toBase64(value) : value.base64;
    const blob = await request(s, "POST", `${base}/git/blobs`, { content, encoding: "base64" });
    entries.push({ path, mode: "100644", type: "blob", sha: blob.sha });
  }
  for (const path of remove) {
    entries.push({ path, mode: "100644", type: "blob", sha: null });
  }

  const tree = await request(s, "POST", `${base}/git/trees`, { base_tree: parent.tree.sha, tree: entries });
  const commit = await request(s, "POST", `${base}/git/commits`, { message, tree: tree.sha, parents: [parentSha] });
  await request(s, "PATCH", `${base}/git/refs/heads/${encodeURIComponent(s.branch)}`, { sha: commit.sha });
  return { sha: commit.sha, message };
}

/**
 * Commit several file changes at once as ONE commit.
 * If the branch moved while committing (422/409), re-fetch and retry once.
 * @param {{message: string, put?: Object<string, string|{base64: string}>, delete?: string[]}} change
 *   `put` maps a repo path to new text, or to `{base64}` for binary files such as images.
 *   `delete` lists repo paths to remove.
 * @param {object} [session]
 * @returns {Promise<{sha: string, short: string, message: string, url: string}>}
 */
export async function commitChanges({ message, put = {}, delete: remove = [] }, session) {
  const s = currentSession(session);
  if (!message || !message.trim()) throw new GitHubError("Write a commit message first.", 0);
  if (!Object.keys(put).length && !remove.length) throw new GitHubError("There is nothing to commit.", 0);

  let result;
  try {
    result = await attemptCommit(s, message, put, remove);
  } catch (err) {
    const moved = err instanceof GitHubError && (err.status === 422 || err.status === 409);
    if (!moved) throw err;
    try {
      result = await attemptCommit(s, message, put, remove);
    } catch (again) {
      if (again instanceof GitHubError && (again.status === 422 || again.status === 409)) {
        throw new GitHubError("Someone else pushed to this branch. Reload the page and try again.", again.status);
      }
      throw again;
    }
  }
  return {
    sha: result.sha,
    short: result.sha.slice(0, 7),
    message: result.message,
    url: `https://github.com/${s.repo}/commit/${result.sha}`
  };
}
