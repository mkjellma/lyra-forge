import { conflict } from "./errors.js";

const DIGEST = /^sha256:[a-f0-9]{64}$/i;
const REPOSITORY = /^[a-z0-9][a-z0-9._/-]{0,127}$/;
const TAG = /^[a-f0-9]{40,64}$/i;

function unavailable() {
  return conflict("ARTIFACT_REGISTRY_UNAVAILABLE");
}

/** Minimal OCI distribution read boundary used only by the token-bearing executor. */
export class OciRegistryClient {
  constructor({ fetchFn, origin }) {
    if (typeof fetchFn !== "function" || typeof origin !== "string" || !/^https?:\/\/[a-z0-9.-]+(?::[0-9]+)?$/i.test(origin)) {
      throw new TypeError("OCI_REGISTRY_CLIENT_CONFIG_REQUIRED");
    }
    this.fetchFn = fetchFn;
    this.origin = origin;
  }

  async getManifestDigest({ repository, tag }) {
    if (typeof repository !== "string" || !REPOSITORY.test(repository) || typeof tag !== "string" || !TAG.test(tag)) throw unavailable();
    let response;
    try {
      response = await this.fetchFn(`${this.origin}/v2/${repository.split("/").map(encodeURIComponent).join("/")}/manifests/${encodeURIComponent(tag)}`, {
        method: "HEAD",
        headers: { accept: "application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json" }
      });
    } catch {
      throw unavailable();
    }
    if (response.status === 404) throw conflict("ARTIFACT_NOT_FOUND");
    if (!response.ok) throw unavailable();
    const digest = response.headers?.get?.("docker-content-digest");
    if (typeof digest !== "string" || !DIGEST.test(digest)) throw unavailable();
    return digest.toLowerCase();
  }
}
