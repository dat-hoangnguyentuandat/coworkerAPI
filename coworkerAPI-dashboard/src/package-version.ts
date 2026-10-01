import { readFileSync } from "node:fs";

/** Resolve source and compiled layouts relative to this module, never process cwd. */
function readPackageVersion(): string {
  for (const relative of ["../package.json", "../../package.json"]) {
    try {
      const manifest = JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));
      if (manifest.name === "coworker-api" && typeof manifest.version === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version)) return manifest.version;
    } catch { /* The other supported module layout may contain the manifest. */ }
  }
  throw new Error("CoworkerAPI package version metadata is missing or invalid.");
}

export const PACKAGE_VERSION = readPackageVersion();
