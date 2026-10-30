/* Copyright (C) 2023-2026 QuantumNous
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { refreshUpstreamReview } from "./upstream-review.mjs";

const sha = (digit) => digit.repeat(40);

function reviewFixture(t, { previous, reviews = [], fail = "" } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "wucora-upstream-review-"));
  t.after(() => {
    assert.ok(temp.startsWith(path.join(os.tmpdir(), "wucora-upstream-review-")));
    fs.rmSync(temp, { recursive: true, force: true });
  });
  const state = {
    pr: previous ? structuredClone(previous) : null,
    reviews: structuredClone(reviews),
    base: sha("a"),
    candidate: sha("b"),
    calls: [],
    env: {
      GITHUB_REPOSITORY: "owner/fork",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_RUN_ID: "101",
      GITHUB_RUN_ATTEMPT: "1",
      RUNNER_TEMP: temp,
      UPSTREAM_SHA: sha("c"),
    },
    pin: { uiReference: sha("d"), integratedUpstream: sha("c") },
  };
  const run = (command, args) => {
    state.calls.push([command, ...args]);
    if (command === "git" && args[0] === "rev-parse") {
      assert.ok(["HEAD", "origin/main"].includes(args[1]));
      return args[1] === "HEAD" ? state.candidate : state.base;
    }
    if (command === "git" && args[0] === "push") {
      assert.deepEqual(args, [
        "push",
        "--force-with-lease",
        "origin",
        "HEAD:refs/heads/automation/upstream-sync",
      ]);
      if (state.pr) {
        assert.equal(state.pr.isDraft, true);
        assert.equal(state.pr.autoMergeRequest, null);
        assert.ok(
          state.reviews.every((r) => r.state !== "APPROVED" || r.commit_id === state.candidate),
        );
        state.pr.headRefOid = state.candidate;
        // Simulates a human adding notes after the initial PR lookup.
        state.pr.body += "\n人工追加：保留配置检查说明\n";
      }
      return "";
    }
    assert.equal(command, "gh");
    if (args[0] === "api") {
      if (args.includes("--paginate")) {
        assert.ok(args.includes("--slurp"));
        return JSON.stringify([state.reviews.slice(0, 1), state.reviews.slice(1)]);
      }
      assert.ok(args.includes("PUT"));
      const endpoint = args.find((a) => a.endsWith("/dismissals"));
      const id = Number(endpoint.split("/").at(-2));
      if (fail === "dismiss") throw Error("Dismissal denied by repository policy");
      state.reviews.find((r) => r.id === id).state = "DISMISSED";
      return "{}";
    }
    assert.equal(args[0], "pr");
    switch (args[1]) {
      case "list":
        return JSON.stringify(state.pr ? [state.pr] : []);
      case "merge":
        assert.ok(args.includes("--disable-auto"));
        state.pr.autoMergeRequest = null;
        return "";
      case "ready":
        assert.ok(args.includes("--undo"));
        if (fail === "draft") throw Error("Draft conversion denied");
        state.pr.isDraft = true;
        return "";
      case "view":
        return JSON.stringify(state.pr);
      case "edit":
      case "create": {
        if (fail === "edit") throw Error("Body update denied");
        const body = fs.readFileSync(args[args.indexOf("--body-file") + 1], "utf8");
        if (args[1] === "create") {
          assert.ok(args.includes("--draft"));
          assert.equal(args[args.indexOf("--base") + 1], "main");
          assert.equal(args[args.indexOf("--head") + 1], "automation/upstream-sync");
          state.pr = {
            number: 7,
            body,
            isDraft: true,
            autoMergeRequest: null,
            headRefOid: state.candidate,
          };
        } else state.pr.body = body;
        return "";
      }
      default:
        throw Error(`Unexpected gh operation: ${args.join(" ")}`);
    }
  };
  return { state, refresh: () => refreshUpstreamReview({ run, env: state.env, pin: state.pin }) };
}

test("creates a draft with the actual base, upstream, candidate, UI and run evidence", (t) => {
  const { state, refresh } = reviewFixture(t);
  refresh();
  for (const value of [
    state.base,
    state.env.UPSTREAM_SHA,
    state.candidate,
    state.pin.uiReference,
    "/actions/runs/101/attempts/1",
    "/actions/runs/101#artifacts",
    "wucora-ui-review-101-1",
  ]) {
    assert.ok(state.pr.body.includes(value), value);
  }
  assert.ok(state.pr.body.includes("- [ ] 本轮视觉与合并批准"));
  assert.equal(state.pr.isDraft, true);
});

test("second candidate refreshes evidence, resets approval and preserves human notes", (t) => {
  const { state, refresh } = reviewFixture(t);
  refresh();
  state.pr.body = `人工前言\n${state.pr.body.replace("- [ ] 本轮视觉", "- [x] 本轮视觉")}\n人工结尾`;
  state.pr.isDraft = false;
  state.pr.autoMergeRequest = { enabledBy: { login: "owner" } };
  state.reviews = [
    { id: 11, state: "APPROVED", commit_id: state.candidate },
    { id: 12, state: "CHANGES_REQUESTED", commit_id: state.candidate },
    { id: 13, state: "APPROVED", commit_id: state.candidate },
  ];
  state.base = sha("1");
  state.candidate = sha("2");
  state.env.UPSTREAM_SHA = state.pin.integratedUpstream = sha("3");
  state.env.GITHUB_RUN_ID = "202";
  state.env.GITHUB_RUN_ATTEMPT = "2";
  state.calls = [];
  refresh();
  const body = state.pr.body;
  for (const value of [
    state.base,
    state.candidate,
    state.env.UPSTREAM_SHA,
    "/actions/runs/202/attempts/2",
    "wucora-ui-review-202-2",
    "人工前言",
    "人工结尾",
    "人工追加：保留配置检查说明",
  ])
    assert.ok(body.includes(value), value);
  for (const value of [sha("a"), sha("b"), sha("c"), "/runs/101", "- [x] 本轮视觉"])
    assert.ok(!body.includes(value), value);
  assert.ok(body.includes("- [ ] 本轮视觉与合并批准"));
  assert.deepEqual(
    state.reviews.map((r) => r.state),
    ["DISMISSED", "CHANGES_REQUESTED", "DISMISSED"],
  );
  assert.ok(state.calls.some((c) => c[1] === "pr" && c[2] === "edit"));
  assert.ok(!state.calls.some((c) => c[1] === "pr" && c[2] === "create"));
  assert.equal(state.pr.headRefOid, state.candidate);
  assert.equal(state.pr.isDraft, true);
  assert.equal(state.pr.autoMergeRequest, null);
});

test("retains an unmarked legacy body as explicitly historical notes", (t) => {
  const previous = {
    number: 7,
    body: "旧轮 Actions /runs/100\n人工说明：[x] 视觉验收通过",
    isDraft: true,
    autoMergeRequest: null,
    headRefOid: sha("e"),
  };
  const { state, refresh } = reviewFixture(t, { previous });
  refresh();
  assert.ok(state.pr.body.includes(previous.body));
  assert.ok(state.pr.body.includes("旧证据和验收不适用于本轮"));
  assert.ok(state.pr.body.indexOf("- [ ] 本轮视觉") < state.pr.body.indexOf(previous.body));
});

for (const fail of ["draft", "dismiss"]) {
  test(`does not push a new candidate if ${fail} invalidation fails`, (t) => {
    const previous = {
      number: 7,
      body: "人工说明",
      isDraft: false,
      autoMergeRequest: { enabledBy: { login: "owner" } },
      headRefOid: sha("e"),
    };
    const { state, refresh } = reviewFixture(t, {
      previous,
      fail,
      reviews: [{ id: 11, state: "APPROVED", commit_id: sha("e") }],
    });
    assert.throws(refresh, /denied/i);
    assert.ok(!state.calls.some((c) => c[0] === "git" && c[1] === "push"));
    assert.equal(state.pr.headRefOid, previous.headRefOid);
  });
}

test("body update failure leaves the advanced candidate draft with no stale approval", (t) => {
  const previous = {
    number: 7,
    body: "人工说明",
    isDraft: false,
    autoMergeRequest: null,
    headRefOid: sha("e"),
  };
  const { state, refresh } = reviewFixture(t, {
    previous,
    fail: "edit",
    reviews: [{ id: 11, state: "APPROVED", commit_id: sha("e") }],
  });
  assert.throws(refresh, /Body update denied/);
  assert.equal(state.pr.headRefOid, state.candidate);
  assert.equal(state.pr.isDraft, true);
  assert.equal(state.pr.autoMergeRequest, null);
  assert.equal(state.reviews[0].state, "DISMISSED");
});

test("ambiguous body markers stop before mutating the existing PR or branch", (t) => {
  const previous = {
    number: 7,
    body: "<!-- wucora-upstream-review:start -->人工说明",
    isDraft: true,
    autoMergeRequest: null,
    headRefOid: sha("e"),
  };
  const { state, refresh } = reviewFixture(t, { previous });
  assert.throws(refresh, /Incomplete automated review markers/);
  assert.equal(state.pr.body, previous.body);
  assert.ok(!state.calls.some((c) => c[1] === "push" || c[2] === "edit"));
});
