import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createForgeRequestHandler } from "../src/http-server.js";
import { SHA_A, makeForge } from "./helpers.js";

async function call(handler, { method, url, headers = {}, body }) {
  const request = Object.assign(
    Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]),
    { method, url, headers }
  );
  const response = {
    status: null,
    body: null,
    writeHead(status) {
      this.status = status;
    },
    end(bodyText) {
      this.body = JSON.parse(bodyText);
    }
  };
  await handler(request, response);
  return response;
}

test("HTTP API requires a bearer token and exposes the bounded deploy capability", async () => {
  const { forge } = makeForge();
  const handler = createForgeRequestHandler({ forge, apiToken: "test-token" });
  const rejected = await call(handler, { method: "GET", url: "/v1/projects/adesco" });
  assert.equal(rejected.status, 401);
  assert.deepEqual(rejected.body, { error: { code: "UNAUTHORIZED" } });

  const deployed = await call(handler, {
      method: "POST",
      url: "/v1/projects/adesco/deploy",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: { commitSha: SHA_A }
    });
  assert.equal(deployed.status, 200);
  assert.equal(deployed.body.release.state, "active");

  const status = await call(handler, {
    method: "GET",
    url: "/v1/projects/adesco",
    headers: { authorization: "Bearer test-token" }
  });
  assert.equal(status.body.activeRelease.commitSha, SHA_A);
});
