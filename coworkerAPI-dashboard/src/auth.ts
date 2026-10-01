import type { FastifyRequest } from "fastify";
import { createHash, timingSafeEqual } from "node:crypto";

export function createKeyAuthenticator(rawKeys: string | undefined, verifyManagedKey?: (token: string) => boolean) {
  const keys = (rawKeys ?? "").split(",").map((key) => key.trim()).filter(Boolean);

  return function authenticate(request: FastifyRequest): boolean {
    const header = request.headers.authorization;
    const apiKeyHeader = request.headers["x-api-key"];
    const apiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : apiKey?.trim();
    if (!token) return false;
    return keys.some((key) => {
      const actualBytes = Buffer.from(key.startsWith("sha256:") ? createHash("sha256").update(token).digest("hex") : token);
      const expectedBytes = Buffer.from(key.startsWith("sha256:") ? key.slice(7) : key);
      return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
    }) || Boolean(verifyManagedKey?.(token));
  };
}
