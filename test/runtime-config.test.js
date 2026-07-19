import test from "node:test";
import assert from "node:assert/strict";
import { loadRuntimeConfig } from "../src/runtime-config.js";

test("runtimekonfigurationen är loopback som standard och kräver komplett Coolify-konfiguration", () => {
  const config = loadRuntimeConfig({ FORGE_API_TOKEN: "test-forge-token" });
  assert.equal(config.bindHost, "127.0.0.1");
  assert.equal(config.port, 3000);
  assert.equal(config.coolify, null);

  assert.throws(() => loadRuntimeConfig({ FORGE_API_TOKEN: "test-forge-token", COOLIFY_API_URL: "http://coolify.internal:8000" }), {
    message: "COOLIFY_CONFIGURATION_INCOMPLETE"
  });
});

test("runtimekonfigurationen godtar privat containerbindning med båda Coolify-värdena", () => {
  const config = loadRuntimeConfig({
    FORGE_API_TOKEN: "test-forge-token",
    FORGE_BIND_HOST: "0.0.0.0",
    FORGE_PORT: "3000",
    COOLIFY_API_URL: "http://coolify.internal:8000",
    COOLIFY_API_TOKEN: "test-coolify-token"
  });
  assert.deepEqual(config, {
    apiToken: "test-forge-token",
    bindHost: "0.0.0.0",
    port: 3000,
    statePath: "data/forge-state.json",
    coolify: { baseUrl: "http://coolify.internal:8000", apiToken: "test-coolify-token" }
  });
  assert.throws(() => loadRuntimeConfig({ FORGE_API_TOKEN: "test-forge-token", FORGE_BIND_HOST: "10.0.0.1" }), { message: "FORGE_BIND_HOST_INVALID" });
});
