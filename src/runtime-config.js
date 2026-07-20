function requiredString(value, code) {
  if (typeof value !== "string" || value.length === 0) throw new Error(code);
  return value;
}

function port(value) {
  const parsed = Number(value ?? 3000);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error("FORGE_PORT_INVALID");
  return parsed;
}

export function loadRuntimeConfig(environment = process.env) {
  const bindHost = environment.FORGE_BIND_HOST ?? "127.0.0.1";
  if (bindHost !== "127.0.0.1" && bindHost !== "0.0.0.0") throw new Error("FORGE_BIND_HOST_INVALID");

  return Object.freeze({
    apiToken: requiredString(environment.FORGE_API_TOKEN, "FORGE_API_TOKEN_REQUIRED"),
    bindHost,
    port: port(environment.FORGE_PORT),
    statePath: environment.FORGE_STATE_PATH ?? "data/forge-state.json"
  });
}
