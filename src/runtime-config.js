function requiredString(value, code) {
  if (typeof value !== "string" || value.length === 0) throw new Error(code);
  return value;
}

function optionalString(value, code) {
  if (value === undefined) return undefined;
  return requiredString(value, code);
}

function port(value) {
  const parsed = Number(value ?? 3000);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error("FORGE_PORT_INVALID");
  return parsed;
}

export function loadRuntimeConfig(environment = process.env) {
  const bindHost = environment.FORGE_BIND_HOST ?? "127.0.0.1";
  if (bindHost !== "127.0.0.1" && bindHost !== "0.0.0.0") throw new Error("FORGE_BIND_HOST_INVALID");

  const apiToken = requiredString(environment.FORGE_API_TOKEN, "FORGE_API_TOKEN_REQUIRED");
  const lyraReadToken = optionalString(environment.FORGE_LYRA_READ_TOKEN, "FORGE_LYRA_READ_TOKEN_INVALID");
  const buildExecutorSocket = optionalString(environment.FORGE_BUILD_EXECUTOR_SOCKET, "FORGE_BUILD_EXECUTOR_SOCKET_INVALID");
  const runtimeExecutorSocket = optionalString(environment.FORGE_RUNTIME_EXECUTOR_SOCKET, "FORGE_RUNTIME_EXECUTOR_SOCKET_INVALID");
  const runtimeProjectsPath = optionalString(environment.FORGE_RUNTIME_PROJECTS_PATH, "FORGE_RUNTIME_PROJECTS_PATH_INVALID");
  if ((runtimeExecutorSocket === undefined) !== (runtimeProjectsPath === undefined)) throw new Error("FORGE_RUNTIME_EXECUTOR_CONFIG_INCOMPLETE");
  if (lyraReadToken === apiToken) throw new Error("FORGE_LYRA_READ_TOKEN_MUST_DIFFER");

  return Object.freeze({
    apiToken,
    bindHost,
    lyraReadToken,
    ...(buildExecutorSocket === undefined ? {} : { buildExecutorSocket }),
    ...(runtimeExecutorSocket === undefined ? {} : { runtimeExecutorSocket, runtimeProjectsPath }),
    port: port(environment.FORGE_PORT),
    statePath: environment.FORGE_STATE_PATH ?? "data/forge-state.json"
  });
}
