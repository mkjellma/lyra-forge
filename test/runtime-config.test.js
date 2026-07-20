import test from "node:test";
import assert from "node:assert/strict";
import { loadRuntimeConfig } from "../src/runtime-config.js";

test("runtimekonfigurationen är loopback som standard utan driftmotorspecifika hemligheter", () => {
  const config = loadRuntimeConfig({ FORGE_API_TOKEN: "test-forge-token" });
  assert.equal(config.bindHost, "127.0.0.1");
  assert.equal(config.port, 3000);
  assert.equal(config.statePath, "data/forge-state.json");
});

test("runtimekonfigurationen godtar privat containerbindning", () => {
  const config = loadRuntimeConfig({
    FORGE_API_TOKEN: "test-forge-token",
    FORGE_BIND_HOST: "0.0.0.0",
    FORGE_PORT: "3000",
    FORGE_STATE_PATH: "/var/lib/forge/state.json"
  });
  assert.deepEqual(config, {
    apiToken: "test-forge-token",
    bindHost: "0.0.0.0",
    port: 3000,
    statePath: "/var/lib/forge/state.json"
  });
  assert.throws(() => loadRuntimeConfig({ FORGE_API_TOKEN: "test-forge-token", FORGE_BIND_HOST: "10.0.0.1" }), { message: "FORGE_BIND_HOST_INVALID" });
});
