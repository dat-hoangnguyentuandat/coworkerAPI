// Allowlisted metadata only; never persist raw health payloads or errors.
const keys = ["queued", "claimed", "submitted", "cancelled", "sendStarted", "ackSeen", "hostInvoked", "delivered", "deliveryUnknown", "deliveryFailed", "recoveredClaims", "repeatedSendStarts", "staleLeaseReports"];
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export function safeDiagnostic(version, bridge) {
  return {
    gatewayVersion: typeof version?.version === "string" && /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version.version) ? version.version : null,
    runtime: ["bridge-v4", "bridge-v5", "bridge-v6", "bridge-v7", "bridge-v8"].includes(bridge?.runtime?.last) ? bridge.runtime.last : null,
    connected: typeof bridge?.connected === "boolean" ? bridge.connected : null,
    pending: count(bridge?.pending), claimed: count(bridge?.claimed), draining: count(bridge?.draining),
    counts: Object.fromEntries(keys.map(key => [key, count(bridge?.counts?.[key])])),
    hostFailureStages: Object.fromEntries(["sync_throw", "async_reject", "deadline", "unspecified"].map(key => [key, count(bridge?.hostFailureStages?.[key])])),
    // This describes tool RPC, NOT the follow-up message transport.
    hostToolTransports: Object.fromEntries(["mcp-apps", "openai-alias", "unspecified"].map(key => [key, count(bridge?.hostTransports?.[key])])),
  };
}
export function diagnosticDelta(initial, final) {
  const sameGateway = typeof initial?.gatewayVersion === "string" && initial.gatewayVersion === final?.gatewayVersion;
  // Counter decreases indicate reset/restart, never zero failures.
  const comparable = sameGateway && keys.every(key => Number.isSafeInteger(initial?.counts?.[key]) && Number.isSafeInteger(final?.counts?.[key]) && final.counts[key] >= initial.counts[key]);
  const deltaGroup = name => {
    const groupKeys = Object.keys(initial?.[name] ?? {});
    const valid = sameGateway && groupKeys.length > 0 && groupKeys.every(key => Number.isSafeInteger(initial[name][key]) && Number.isSafeInteger(final?.[name]?.[key]) && final[name][key] >= initial[name][key]);
    return { comparable: valid, values: Object.fromEntries(groupKeys.map(key => [key, valid ? final[name][key] - initial[name][key] : null])) };
  };
  return { comparable, counts: Object.fromEntries(keys.map(key => [key, comparable ? final.counts[key] - initial.counts[key] : null])), hostFailureStages: deltaGroup("hostFailureStages"), hostToolTransports: deltaGroup("hostToolTransports") };
}
export async function readDiagnostic(base) {
  const get = async path => {
    try {
      const response = await fetch(base + path, { signal: AbortSignal.timeout(3000) });
      return response.ok ? await response.json() : null;
    } catch { return null; }
  };
  const [version, bridge] = await Promise.all([get("/version"), get("/health/bridge")]);
  return safeDiagnostic(version, bridge);
}
