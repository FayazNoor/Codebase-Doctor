/**
 * GitHub sandbox for end-to-end runs without touching real GitHub.
 *
 *  - A local HTTP server that implements the four GitHub REST endpoints the
 *    MCP server calls (repo metadata, list PRs, create PR, add labels).
 *    Point the server at it with GITHUB_API_URL.
 *  - A local bare repository that receives `git push` for
 *    https://github.com/<owner>/<repo>.git through a git `insteadOf` rewrite in
 *    a throwaway global gitconfig (GIT_CONFIG_GLOBAL).
 *
 * Every page it serves says it is a sandbox. It is test infrastructure, not
 * part of the product, and nothing here talks to github.com.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * @param {{ owner: string, repo: string, sourceRepo: string, dir: string }} opts
 *   sourceRepo — local git repo whose history seeds the sandbox "remote".
 */
export async function startGitHubSandbox({ owner, repo, sourceRepo, dir }) {
  fs.mkdirSync(dir, { recursive: true });
  const bare = path.join(dir, `${repo}.git`);
  execFileSync("git", ["clone", "-q", "--bare", sourceRepo, bare]);

  const pulls = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://sandbox");
    const json = (status, body) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(body));
    };
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const p = url.pathname.split("/").filter(Boolean);
      const isRepo = p[1] === owner && p[2] === repo;

      if (req.method === "GET" && p[0] === "repos" && p.length === 3) {
        if (!isRepo) return json(404, { message: "Not Found", documentation_url: "https://docs.github.com/rest" });
        return json(200, {
          default_branch: "main",
          full_name: `${owner}/${repo}`,
          clone_url: `https://github.com/${owner}/${repo}.git`,
          private: false,
          archived: false,
        });
      }
      if (req.method === "GET" && p[0] === "repos" && isRepo && p[3] === "pulls") {
        const head = url.searchParams.get("head");
        return json(200, pulls.filter((pr) => `${owner}:${pr.head}` === head && pr.state === "open"));
      }
      if (req.method === "POST" && p[0] === "repos" && isRepo && p[3] === "pulls") {
        const input = JSON.parse(body || "{}");
        if (pulls.some((pr) => pr.head === input.head && pr.state === "open")) {
          return json(422, { message: "Validation Failed", errors: [{ message: `A pull request already exists for ${owner}:${input.head}.` }] });
        }
        const number = pulls.length + 1;
        const port = server.address().port;
        const pr = {
          number,
          state: "open",
          title: input.title,
          head: input.head,
          base: input.base,
          body: input.body,
          labels: [],
          html_url: `http://127.0.0.1:${port}/${owner}/${repo}/pull/${number}`,
          created_at: new Date().toISOString(),
        };
        pulls.push(pr);
        return json(201, pr);
      }
      if (req.method === "POST" && p[0] === "repos" && isRepo && p[3] === "issues" && p[5] === "labels") {
        const pr = pulls.find((x) => x.number === Number(p[4]));
        if (pr) pr.labels = JSON.parse(body || "{}").labels ?? [];
        return json(200, (pr?.labels ?? []).map((name) => ({ name })));
      }
      // Human-readable record of a PR the tool opened (for review / screenshots).
      if (req.method === "GET" && p[0] === owner && p[1] === repo && p[2] === "pull") {
        const pr = pulls.find((x) => x.number === Number(p[3]));
        if (!pr) {
          res.writeHead(404, { "content-type": "text/plain" });
          return res.end("No such sandbox pull request");
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(renderPrPage(pr, owner, repo, bare));
      }
      json(404, { message: `Sandbox does not implement ${req.method} ${url.pathname}` });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  // Push https://github.com/<owner>/<repo>.git → the local bare repo.
  const gitconfig = path.join(dir, "gitconfig");
  fs.writeFileSync(
    gitconfig,
    [
      "[user]",
      "\tname = Codebase Doctor Demo",
      "\temail = demo@codebase-doctor.invalid",
      `[url "${pathToFileURL(bare).href}"]`,
      `\tinsteadOf = https://github.com/${owner}/${repo}.git`,
      "[core]",
      "\tautocrlf = false",
      "",
    ].join("\n")
  );

  return {
    apiUrl: `http://127.0.0.1:${port}`,
    bare,
    gitconfig,
    pulls,
    env: {
      GITHUB_API_URL: `http://127.0.0.1:${port}`,
      GITHUB_TOKEN: "sandbox-token-not-a-real-credential",
      GIT_CONFIG_GLOBAL: gitconfig,
      GIT_CONFIG_NOSYSTEM: "1",
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export function renderPrPage(pr, owner, repo, bare) {
  const log = execFileSync("git", ["--git-dir", bare, "log", "--oneline", `refs/heads/${pr.head}`, "-n", "20"], { encoding: "utf8" });
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sandbox PR #${pr.number} · ${esc(owner)}/${esc(repo)}</title>
<script src="https://cdn.jsdelivr.net/npm/marked@12/marked.min.js"></script>
<style>
 body{margin:0;background:#f4f4f1;color:#26262b;font:14px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
 .banner{background:#26262b;color:#fafaf8;padding:10px 24px;font:12.5px/1.5 ui-monospace,Menlo,Consolas,monospace}
 .banner b{color:#f0a93b}
 main{max-width:920px;margin:0 auto;padding:24px}
 .meta{font:12.5px ui-monospace,Menlo,Consolas,monospace;color:#55555d}
 .card{background:#fff;border:1px solid #deded8;border-radius:10px;padding:20px 24px;margin-top:16px}
 h1{font-size:20px;margin:6px 0}
 table{border-collapse:collapse;width:100%;font-size:13px}
 th,td{border:1px solid #e3e3de;padding:6px 8px;text-align:left;vertical-align:top}
 code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px}
 pre{background:#f4f4f1;padding:10px;border-radius:8px;overflow:auto}
 .pill{display:inline-block;padding:1px 8px;border-radius:999px;background:#e8f6ec;color:#15803d;font-weight:700;font-size:12px}
</style></head><body>
<div class="banner"><b>Codebase Doctor sandbox</b> — not GitHub. This page shows the pull request exactly as the tool sent it to the mocked GitHub API (${esc(owner)}/${esc(repo)}), and the commits that were pushed to the sandbox's local bare repository.</div>
<main>
 <div class="meta">${esc(owner)}/${esc(repo)} · pull request #${pr.number} · <span class="pill">${esc(pr.state)}</span> · <code>${esc(pr.head)}</code> → <code>${esc(pr.base)}</code> · labels: ${pr.labels.map(esc).join(", ") || "—"}</div>
 <h1>${esc(pr.title)}</h1>
 <div class="card"><div class="meta">Commits pushed</div><pre><code>${esc(log)}</code></pre></div>
 <div class="card" id="body"><pre>${esc(pr.body)}</pre></div>
</main>
<script>try{document.getElementById("body").innerHTML=marked.parse(${JSON.stringify(pr.body).replace(/</g, "\\u003c")})}catch(e){}</script>
</body></html>`;
}
