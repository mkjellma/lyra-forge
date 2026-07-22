import test from "node:test";
import assert from "node:assert/strict";
import { loadRuntimeConfig } from "../src/runtime-config.js";

const LYRA_READ_TOKEN = "a".repeat(64);

test("runtimekonfigurationen är loopback som standard utan driftmotorspecifika hemligheter", () => {
  const config = loadRuntimeConfig({ FORGE_API_TOKEN: "test-forge-token" });
  assert.equal(config.bindHost, "127.0.0.1");
  assert.equal(config.lyraReadToken, undefined);
  assert.equal(config.port, 3000);
  assert.equal(config.statePath, "data/forge-state.json");
});

test("runtimekonfigurationen godtar privat containerbindning", () => {
  const config = loadRuntimeConfig({
    FORGE_API_TOKEN: "test-forge-token",
    FORGE_LYRA_READ_TOKEN: LYRA_READ_TOKEN,
    FORGE_BIND_HOST: "0.0.0.0",
    FORGE_PORT: "3000",
    FORGE_STATE_PATH: "/var/lib/forge/state.json"
  });
  assert.deepEqual(config, {
    apiToken: "test-forge-token",
    bindHost: "0.0.0.0",
    lyraReadToken: LYRA_READ_TOKEN,
    port: 3000,
    statePath: "/var/lib/forge/state.json"
  });
  assert.throws(() => loadRuntimeConfig({ FORGE_API_TOKEN: "test-forge-token", FORGE_BIND_HOST: "10.0.0.1" }), { message: "FORGE_BIND_HOST_INVALID" });
});

test("runtimekonfigurationen håller den valfria Lyra-läsidentiteten separat från adminidentiteten", () => {
  assert.throws(
    () => loadRuntimeConfig({ FORGE_API_TOKEN: "admin-token", FORGE_LYRA_READ_TOKEN: "" }),
    { message: "FORGE_LYRA_READ_TOKEN_INVALID" }
  );
  assert.throws(
    () => loadRuntimeConfig({ FORGE_API_TOKEN: "admin-token", FORGE_LYRA_READ_TOKEN: "too-short" }),
    { message: "FORGE_LYRA_READ_TOKEN_INVALID" }
  );
  assert.throws(
    () => loadRuntimeConfig({ FORGE_API_TOKEN: LYRA_READ_TOKEN, FORGE_LYRA_READ_TOKEN: LYRA_READ_TOKEN }),
    { message: "FORGE_LYRA_READ_TOKEN_MUST_DIFFER" }
  );
});

test("runtimekonfigurationen kan aktivera enbart den lokala executor-socketen", () => {
  const config = loadRuntimeConfig({ FORGE_API_TOKEN: "admin", FORGE_BUILD_EXECUTOR_SOCKET: "/var/run/forge-executor/executor.sock" });
  assert.equal(config.buildExecutorSocket, "/var/run/forge-executor/executor.sock");
});

test("runtimevägen kräver både privat socket och ägarinventering", () => {
  assert.throws(
    () => loadRuntimeConfig({ FORGE_API_TOKEN: "admin", FORGE_RUNTIME_EXECUTOR_SOCKET: "/var/run/forge-executor/runtime.sock" }),
    { message: "FORGE_RUNTIME_EXECUTOR_CONFIG_INCOMPLETE" }
  );
  const config = loadRuntimeConfig({ FORGE_API_TOKEN: "admin", FORGE_RUNTIME_EXECUTOR_SOCKET: "/var/run/forge-executor/runtime.sock", FORGE_RUNTIME_PROJECTS_PATH: "/etc/forge-runtime/projects.json" });
  assert.equal(config.runtimeExecutorSocket, "/var/run/forge-executor/runtime.sock");
  assert.equal(config.runtimeProjectsPath, "/etc/forge-runtime/projects.json");
});
