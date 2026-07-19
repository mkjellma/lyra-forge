import test from "node:test";
import assert from "node:assert/strict";
import { GithubRestPoller } from "../src/github-polling.js";
import { SHA_A, SHA_B, exampleProject, makeForge } from "./helpers.js";

function fixtureResponse({ status = 200, body = [], etag = null }) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => name === "etag" ? etag : null },
    json: async () => body
  };
}

test("GitHub poller reads only the registered branch through an injected local fixture", async () => {
  const calls = [];
  const poller = new GithubRestPoller({
    fetchFn: async (url, options) => {
      calls.push({ url: url.toString(), options });
      return fixtureResponse({ body: [{ sha: SHA_A }], etag: "fixture-etag" });
    },
    now: () => "2026-07-19T00:00:00.000Z"
  });

  const status = await poller.poll(exampleProject());
  assert.deepEqual(status, {
    state: "candidate",
    checkedAt: "2026-07-19T00:00:00.000Z",
    commitSha: SHA_A,
    errorCategory: null,
    etag: "fixture-etag"
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.github.com/repos/example/adesco/commits?sha=main&per_page=1");
  assert.deepEqual(calls[0].options.headers, {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28"
  });

  await poller.assertAllowedCommit(exampleProject(), SHA_A);
  await assert.rejects(() => poller.assertAllowedCommit(exampleProject(), SHA_B), { code: "COMMIT_NOT_ALLOWED" });
});

test("GitHub poll failure is content-free and appears in project poll status and audit", async () => {
  const poller = new GithubRestPoller({
    fetchFn: async () => fixtureResponse({ status: 403 }),
    now: () => "2026-07-19T00:00:00.000Z"
  });
  const { forge, audit } = makeForge({ gitProvider: poller });

  const status = await forge.pollProject("adesco");
  assert.deepEqual(status, {
    state: "failed",
    checkedAt: "2026-07-19T00:00:00.000Z",
    commitSha: null,
    errorCategory: "GITHUB_AUTH_FAILED",
    etag: null
  });
  assert.equal((await forge.getProjectStatus("adesco")).poll.errorCategory, "GITHUB_AUTH_FAILED");
  assert.equal(audit.listByProject("adesco")[0].action, "poll");
  assert.equal(audit.listByProject("adesco")[0].errorCategory, "GITHUB_AUTH_FAILED");
});

test("poll status is serializable into Forge state and restores without a GitHub call", async () => {
  const persisted = [];
  const poller = new GithubRestPoller({
    fetchFn: async () => fixtureResponse({ body: [{ sha: SHA_A }], etag: "fixture-etag" }),
    now: () => "2026-07-19T00:00:00.000Z"
  });
  const { forge } = makeForge({
    gitProvider: poller,
    stateStore: { save: async (state) => persisted.push(structuredClone(state)) }
  });

  await forge.pollProject("adesco");
  const restored = new GithubRestPoller({
    fetchFn: async () => { throw new Error("poll status restore must not fetch"); },
    state: persisted.at(-1).gitProviderState
  });
  assert.equal(restored.getPollStatus("adesco").commitSha, SHA_A);
  assert.equal(restored.getPollStatus("adesco").etag, "fixture-etag");
});
