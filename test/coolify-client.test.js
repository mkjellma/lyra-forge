import test from "node:test";
import assert from "node:assert/strict";
import { CoolifyHttpClient } from "../src/coolify-client.js";

test("Coolify-klienten skickar typade anrop med runtime-token utan att exponera den i svaret", async () => {
  const calls = [];
  const client = new CoolifyHttpClient({
    baseUrl: "http://coolify.internal:8000",
    apiToken: "test-token",
    fetchFn: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ uuid: "application-123" }) };
    }
  });

  assert.deepEqual(await client.request({
    method: "PATCH",
    path: "/applications/application-123",
    body: { git_commit_sha: "a".repeat(40), is_auto_deploy_enabled: false }
  }), { uuid: "application-123" });
  assert.deepEqual(calls, [{
    url: "http://coolify.internal:8000/api/v1/applications/application-123",
    options: {
      method: "PATCH",
      headers: {
        accept: "application/json",
        authorization: "Bearer test-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({ git_commit_sha: "a".repeat(40), is_auto_deploy_enabled: false })
    }
  }]);
});

test("Coolify-klienten avvisar obundna sökvägar och normaliserar transportfel", async () => {
  const client = new CoolifyHttpClient({
    baseUrl: "http://coolify.internal:8000",
    apiToken: "test-token",
    fetchFn: async () => { throw new Error("network detail must not escape"); }
  });
  await assert.rejects(() => client.request({ method: "GET", path: "/applications/app?free=query" }), { code: "COOLIFY_PROTOCOL_VIOLATION" });
  await assert.rejects(() => client.request({ method: "GET", path: "/applications/application-123" }), { code: "COOLIFY_UNAVAILABLE" });
  assert.throws(() => new CoolifyHttpClient({ baseUrl: "http://user:pass@coolify.internal", apiToken: "test-token" }), { message: "COOLIFY_API_URL_INVALID" });
});
