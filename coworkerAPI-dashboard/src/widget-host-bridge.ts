/** Inline, dependency-free MCP Apps tool transport. Never logs RPC payloads. */
export const WIDGET_HOST_BRIDGE_JS = `
let hostTransport = 'openai-alias';
let rpcSequence = 0;
const rpcWaiters = new Map();
const standardHostAvailable = typeof window.addEventListener === 'function' && typeof window.parent?.postMessage === 'function';
function hostCanCallTools() { return standardHostAvailable || typeof window.openai?.callTool === 'function'; }
function hostRpc(method, params, timeoutMs=10000) {
  if (rpcWaiters.size >= 32) return Promise.reject(new Error('host_rpc_capacity'));
  return new Promise((resolve, reject) => {
    const id = ++rpcSequence;
    const timer = setTimeout(() => {
      rpcWaiters.delete(id);
      const error = new Error('host_rpc_timeout'); error.bridgeTimeout = true;
      reject(error);
    }, timeoutMs);
    rpcWaiters.set(id, { resolve, reject, timer });
    try { window.parent.postMessage({ jsonrpc:'2.0', id, method, params }, '*'); }
    catch (_) { rpcWaiters.delete(id); clearTimeout(timer); reject(new Error('host_rpc_post_failed')); }
  });
}
if (standardHostAvailable) window.addEventListener('message', event => {
  if (event.source !== window.parent) return;
  const message = event.data;
  if (!message || message.jsonrpc !== '2.0' || !Number.isSafeInteger(message.id) || message.method !== undefined) return;
  const waiter = rpcWaiters.get(message.id);
  if (!waiter || (Object.prototype.hasOwnProperty.call(message,'result') === Object.prototype.hasOwnProperty.call(message,'error'))) return;
  rpcWaiters.delete(message.id); clearTimeout(waiter.timer);
  if (Object.prototype.hasOwnProperty.call(message,'error')) waiter.reject(new Error('host_rpc_rejected'));
  else waiter.resolve(message.result);
}, { passive:true });
const hostBridgeReady = standardHostAvailable ? (async () => {
  try {
    const result = await hostRpc('ui/initialize', { appInfo:{ name:'CoworkerAPI bridge', version:'8' }, appCapabilities:{}, protocolVersion:'2026-01-26' });
    if (result?.protocolVersion !== '2026-01-26') throw new Error('unsupported_host_protocol');
    window.parent.postMessage({ jsonrpc:'2.0', method:'ui/notifications/initialized', params:{} }, '*');
    hostTransport = 'mcp-apps';
  } catch (_) {
    // Initialization performs no inference/tool invocation. Only here may we
    // choose the compatibility alias; never fall back after a tools/call timeout.
    hostTransport = 'openai-alias';
  }
})() : Promise.resolve();
async function callHostTool(name, args) {
  await hostBridgeReady;
  if (hostTransport === 'mcp-apps') return hostRpc('tools/call', { name, arguments:args });
  if (typeof window.openai?.callTool !== 'function') throw new Error('host_tools_unavailable');
  return window.openai.callTool(name, args);
}
`;
