const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const owner = process.env.GITHUB_OWNER || "";
const repo = process.env.GITHUB_REPO || "";
const branch = process.env.GITHUB_BRANCH || "main";
const token = process.env.GITHUB_TOKEN || "";
const root = process.cwd();

if (!owner || !repo || !token) {
  throw new Error("GITHUB_OWNER, GITHUB_REPO and GITHUB_TOKEN are required.");
}

const apiBase = `https://api.github.com/repos/${owner}/${repo}`;
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "guzhenren-reader-publisher"
};

function git(args, opts = {}) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: opts.encoding || "utf8",
    maxBuffer: 1024 * 1024 * 50
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(method, url, body, attempt = 1) {
  const options = { method, headers: { ...headers } };
  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json; charset=utf-8";
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!response.ok) {
      const message = data && data.message ? data.message : text;
      const error = new Error(`${method} ${url} -> ${response.status}: ${message}`);
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (attempt < 6 && (!error.status || error.status >= 500 || error.code === "ECONNRESET" || error.cause)) {
      await sleep(1200 * attempt * attempt);
      return request(method, url, body, attempt + 1);
    }
    throw error;
  }
}

function localEntries() {
  const result = spawnSync("git", ["ls-tree", "-r", "-z", "HEAD"], {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 1024 * 1024 * 50
  });
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout));
  }

  return result.stdout.toString("utf8").split("\0").filter(Boolean).map((line) => {
    const tab = line.indexOf("\t");
    const meta = line.slice(0, tab).split(/\s+/);
    const filePath = line.slice(tab + 1);
    return {
      mode: meta[0],
      type: meta[1],
      sha: meta[2],
      path: filePath
    };
  });
}

async function ensureRepository() {
  try {
    await request("GET", apiBase);
    return;
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  await request("POST", "https://api.github.com/user/repos", {
    name: repo,
    description: "蛊真人漫画静态 PWA 阅读器",
    private: false,
    has_issues: false,
    has_projects: false,
    has_wiki: false,
    auto_init: false
  });
}

async function ensureBranch() {
  try {
    return await request("GET", `${apiBase}/git/ref/heads/${branch}`);
  } catch (error) {
    if (error.status !== 404 && error.status !== 409) throw error;
  }

  await request("PUT", `${apiBase}/contents/README.md`, {
    message: "Initialize repository",
    content: Buffer.from(`# ${repo}\n`, "utf8").toString("base64"),
    branch
  });
  return request("GET", `${apiBase}/git/ref/heads/${branch}`);
}

async function remoteTreeMap(commitSha) {
  const commit = await request("GET", `${apiBase}/git/commits/${commitSha}`);
  const tree = await request("GET", `${apiBase}/git/trees/${commit.tree.sha}?recursive=1`);
  const map = new Map();
  for (const item of tree.tree || []) {
    if (item.type === "blob") {
      map.set(item.path, item.sha);
    }
  }
  return { map, treeSha: commit.tree.sha };
}

async function uploadBlob(entry) {
  const absolute = path.join(root, ...entry.path.split("/"));
  const content = fs.readFileSync(absolute);
  const blob = await request("POST", `${apiBase}/git/blobs`, {
    content: content.toString("base64"),
    encoding: "base64"
  });
  return { sha: blob.sha, size: content.length };
}

async function enablePages() {
  try {
    await request("GET", `${apiBase}/pages`);
    return "exists";
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  try {
    await request("POST", `${apiBase}/pages`, {
      source: {
        branch,
        path: "/docs"
      }
    });
    return "created";
  } catch (error) {
    if (error.status === 409 || error.status === 422) {
      return "needs-manual-settings";
    }
    throw error;
  }
}

async function main() {
  await ensureRepository();
  const ref = await ensureBranch();
  const parentSha = ref.object.sha;
  const remote = await remoteTreeMap(parentSha);
  const entries = localEntries();
  const tree = [];
  let uploaded = 0;
  let uploadedBytes = 0;

  console.log(`api_parent=${parentSha}`);
  console.log(`api_files=${entries.length}`);

  for (const entry of entries) {
    let sha = entry.sha;
    if (remote.map.get(entry.path) !== entry.sha) {
      const blob = await uploadBlob(entry);
      sha = blob.sha;
      uploaded += 1;
      uploadedBytes += blob.size;
      if (uploaded % 5 === 0) {
        console.log(`api_uploaded_changed=${uploaded} bytes=${uploadedBytes}`);
      }
    }
    tree.push({ path: entry.path, mode: entry.mode, type: "blob", sha });
  }

  const treeObject = await request("POST", `${apiBase}/git/trees`, { tree });
  if (treeObject.sha === remote.treeSha) {
    console.log("api_publish=no-changes");
    console.log(`api_pages=${await enablePages()}`);
    return;
  }

  const commitMessage = git(["log", "-1", "--pretty=%B"]).trim() || "Publish static comic reader";
  const localCommit = git(["rev-parse", "HEAD"]).trim();
  const commit = await request("POST", `${apiBase}/git/commits`, {
    message: `${commitMessage}\n\nLocal commit: ${localCommit}`,
    tree: treeObject.sha,
    parents: [parentSha]
  });
  await request("PATCH", `${apiBase}/git/refs/heads/${branch}`, {
    sha: commit.sha,
    force: true
  });

  console.log(`api_uploaded_changed=${uploaded} bytes=${uploadedBytes}`);
  console.log(`api_commit=${commit.sha}`);
  console.log(`api_pages=${await enablePages()}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
