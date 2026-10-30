/* Copyright (C) 2023-2026 QuantumNous
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const start = "<!-- wucora-upstream-review:start -->";
const end = "<!-- wucora-upstream-review:end -->";

// Only this block is replaced. Unmarked legacy bodies remain as historical notes.
export function updateReviewBody(previous, generated) {
  const first = previous.indexOf(start);
  const last = previous.indexOf(end);
  if (first === -1 && last === -1) {
    if (!previous.trim()) return generated;
    return `${generated}\n\n<details>\n<summary>前轮正文存档（含人工说明；旧证据和验收不适用于本轮）</summary>\n\n${previous}\n\n</details>\n`;
  }
  assert.ok(first >= 0 && last > first, "Incomplete automated review markers");
  assert.equal(previous.indexOf(start, first + start.length), -1, "Duplicate review markers");
  assert.equal(previous.indexOf(end, last + end.length), -1, "Duplicate review markers");
  return previous.slice(0, first) + generated + previous.slice(last + end.length);
}

export function refreshUpstreamReview({ run, env, pin }) {
  const repo = env.GITHUB_REPOSITORY;
  assert.match(repo, /^[\w.-]+\/[\w.-]+$/);
  assert.match(env.GITHUB_RUN_ID, /^\d+$/);
  assert.match(env.GITHUB_RUN_ATTEMPT, /^\d+$/);
  assert.ok(path.isAbsolute(env.RUNNER_TEMP), "RUNNER_TEMP must be an absolute path");
  const server = new URL(env.GITHUB_SERVER_URL);
  assert.equal(server.protocol, "https:");
  const upstream = env.UPSTREAM_SHA;
  const base = run("git", ["rev-parse", "origin/main"]).trim();
  const candidate = run("git", ["rev-parse", "HEAD"]).trim();
  for (const sha of [upstream, base, candidate, pin.uiReference]) {
    assert.match(sha, /^[0-9a-f]{40}$/);
  }
  assert.equal(pin.integratedUpstream, upstream, "Candidate upstream metadata differs");
  const runURL = `${server.origin}/${repo}/actions/runs/${env.GITHUB_RUN_ID}`;
  const generated = `${start}
## 本轮同步证据（AI-assisted）

- Fork base: \`${base}\`
- Pinned upstream: \`${upstream}\`
- Tested candidate: \`${candidate}\`
- WuCora UI reference: \`${pin.uiReference}\`
- [本轮 Actions](${runURL}/attempts/${env.GITHUB_RUN_ATTEMPT})
- [本轮截图、结果与质量记录](${runURL}#artifacts)：\`wucora-ui-review-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}\`

候选已在推送前完成 Go/独立模块、前端、质量回归、页脚三数据库及真实网关页面检查。既有 lint 诊断保留；此记录不是全项目迁移认证。

## 本轮人工审阅（仅适用于上述候选 SHA）

- [ ] 重新审阅本轮代码、上游新增功能与截图
- [ ] 本轮视觉与合并批准

代码更新后必须重新审阅。区块外人工说明予以保留，但此前验收不能代替本轮批准。保持草稿和 merge commit 历史；发布、部署需另行批准。
${end}`;
  const open = JSON.parse(
    run("gh", [
      "pr",
      "list",
      "--repo",
      repo,
      "--state",
      "open",
      "--head",
      "automation/upstream-sync",
      "--base",
      "main",
      "--json",
      "number,body,isDraft,autoMergeRequest",
    ]),
  );
  assert.ok(open.length <= 1, "Multiple open upstream sync PRs");
  const existing = open[0];
  if (existing) {
    // Check markers before any remote mutation; never overwrite ambiguous notes.
    updateReviewBody(existing.body || "", generated);
    if (existing.autoMergeRequest) {
      run("gh", ["pr", "merge", String(existing.number), "--repo", repo, "--disable-auto"]);
    }
    if (!existing.isDraft) {
      run("gh", ["pr", "ready", String(existing.number), "--repo", repo, "--undo"]);
    }
    const pages = JSON.parse(
      run("gh", [
        "api",
        "--paginate",
        "--slurp",
        `repos/${repo}/pulls/${existing.number}/reviews?per_page=100`,
        "--jq",
        "map({id,state,commit_id})",
      ]),
    );
    for (const review of pages.flat()) {
      // Retain requested changes and comments. If stale approvals cannot be
      // dismissed (e.g. protected-branch policy), fail BEFORE the branch push.
      if (review.state !== "APPROVED" || review.commit_id === candidate) continue;
      run("gh", [
        "api",
        "--method",
        "PUT",
        `repos/${repo}/pulls/${existing.number}/reviews/${review.id}/dismissals`,
        "-f",
        `message=Upstream candidate advancing to ${candidate}; review again.`,
        "-f",
        "event=DISMISS",
      ]);
    }
  }

  run("git", ["push", "--force-with-lease", "origin", "HEAD:refs/heads/automation/upstream-sync"]);
  let previous = "";
  if (existing) {
    // Read notes again after the push so notes added during validation survive.
    const current = JSON.parse(
      run("gh", [
        "pr",
        "view",
        String(existing.number),
        "--repo",
        repo,
        "--json",
        "body,isDraft,headRefOid,autoMergeRequest",
      ]),
    );
    assert.equal(current.headRefOid, candidate, "Sync PR head changed concurrently");
    assert.equal(current.isDraft, true, "Sync PR must remain a draft");
    assert.equal(current.autoMergeRequest, null, "Sync PR must not auto-merge");
    previous = current.body || "";
  }
  const bodyFile = path.join(env.RUNNER_TEMP, "upstream-pr.md");
  fs.writeFileSync(bodyFile, updateReviewBody(previous, generated));
  if (existing) {
    run("gh", ["pr", "edit", String(existing.number), "--repo", repo, "--body-file", bodyFile]);
  } else {
    run("gh", [
      "pr",
      "create",
      "--repo",
      repo,
      "--base",
      "main",
      "--head",
      "automation/upstream-sync",
      "--draft",
      "--title",
      "chore: review New API upstream updates",
      "--body-file",
      bodyFile,
    ]);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  refreshUpstreamReview({
    run: (command, args) => execFileSync(command, args, { encoding: "utf8" }),
    env: process.env,
    pin: JSON.parse(fs.readFileSync(".github/wucora-ui.json", "utf8")),
  });
}
