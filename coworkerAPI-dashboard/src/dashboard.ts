import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { LocalStore } from "./local-store.js";
import type { TunnelStatus } from "./tunnel.js";
import { probeProvider, providerBaseUrl } from "./provider-http.js";
import type { RequestLimits } from "./request-limits.js";
import { DASHBOARD_STYLE, DASHBOARD_SHELL, dashboardIcon } from "./dashboard-design.js";
import { DASHBOARD_TOUR_SCRIPT } from "./dashboard-tour.js";
import { TOUR_IMAGES, tourImage } from './dashboard-tour-assets.js';
import { BRIDGE_ACTIVATION_URL } from './branding.js';
import { DASHBOARD_LIVE_SCRIPT } from './dashboard-live.js';
import type { TunnelAdmin } from './tunnel-admin.js';
import { DASHBOARD_MOTION_SCRIPT } from './dashboard-motion.js';
import { COWORKER_LOGO } from './dashboard-brand.js';
import { DASHBOARD_I18N_SCRIPT } from './dashboard-i18n.js';
import { DASHBOARD_CONNECTION_SCRIPT } from './dashboard-connections.js';

type Session = { csrf: string; expiresAt: number };
const COOKIE = "cwapi_admin";
const SESSION_MS = 12 * 60 * 60 * 1000;

export function registerDashboard(app: FastifyInstance, store: LocalStore, bridgeStatus: () => string, tunnelStatus: () => TunnelStatus = () => ({ state: "disabled", message: "Tunnel is not configured." }), limits?: RequestLimits, tunnelAdmin?: TunnelAdmin): void {
  const sessions = new Map<string, Session>();
  const sessionFor = (request: FastifyRequest): Session | undefined => {
    const match = request.headers.cookie?.match(/(?:^|;\s*)cwapi_admin=([A-Za-z0-9_-]+)/);
    const session = match ? sessions.get(match[1]) : undefined;
    if (session && session.expiresAt > Date.now()) return session;
    if (match) sessions.delete(match[1]);
    return undefined;
  };
  const validOrigin = (request: FastifyRequest): boolean => {
    const origin = request.headers.origin;
    if (!origin) return true;
    try { return new URL(origin).host === request.headers.host; } catch { return false; }
  };
  const localClient = (request: FastifyRequest): boolean => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.ip);
  // Explicit deployment opt-in only. Setup remains loopback-only; provision
  // the initial password through the server bootstrap secret before exposing it.
  const remoteAdmin = process.env.COWORKER_ADMIN_ALLOW_REMOTE === "true";
  const adminClient = (request: FastifyRequest): boolean => localClient(request) || remoteAdmin;
  const requireAdmin = (request: FastifyRequest, reply: { code: (status: number) => { send: (body: unknown) => unknown } }, mutation = false): Session | undefined => {
    if (!adminClient(request)) { reply.code(403).send({ error: "local_only" }); return; }
    const session = sessionFor(request);
    if (!session) { reply.code(401).send({ error: "login_required" }); return; }
    if (mutation && (!validOrigin(request) || request.headers["x-coworker-csrf"] !== session.csrf)) {
      reply.code(403).send({ error: "csrf_failed" }); return;
    }
    return session;
  };

  app.get("/", async (_request, reply) => reply.redirect("/dashboard"));
  app.get("/dashboard/assets/coworker-logo.png", async (_request, reply) =>
    reply.type("image/png").header("cache-control", "public, max-age=86400").send(COWORKER_LOGO));
  app.get("/favicon.ico", async (_request, reply) => reply.redirect("/dashboard/assets/coworker-logo.png"));
  for (const name of TOUR_IMAGES) {
    const payload = tourImage(name);
    app.get(`/dashboard/assets/guide/${name}`, async (_request, reply) =>
      reply.type(name.endsWith('.png') ? 'image/png' : name.endsWith('.svg') ? 'image/svg+xml' : 'image/jpeg').header('cache-control', 'public, max-age=86400').header('x-content-type-options', 'nosniff').send(payload));
  }
  app.get("/dashboard", async (_request, reply) => reply.type("text/html; charset=utf-8").header("cache-control", "no-store").send(DASHBOARD_HTML));
  app.get("/api/admin/v1/session", async (request) => {
    const session = sessionFor(request);
    return { initialized: store.initialized, loggedIn: Boolean(session), csrf: session?.csrf };
  });
  app.post("/api/admin/v1/setup", async (request, reply) => {
    if (!localClient(request) || !validOrigin(request)) return reply.code(403).send({ error: "local_only" });
    if (store.initialized) return reply.code(409).send({ error: "already_initialized" });
    const parsed = z.object({ password: z.string().min(6).max(256) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_password" });
    store.setup(parsed.data.password);
    return { status: "created" };
  });
  app.post("/api/admin/v1/login", async (request, reply) => {
    if (!adminClient(request) || !validOrigin(request)) return reply.code(403).send({ error: "local_only" });
    const parsed = z.object({ password: z.string() }).safeParse(request.body);
    if (!parsed.success || !store.verifyPassword(parsed.data.password)) return reply.code(401).send({ error: "invalid_credentials" });
    const token = randomBytes(32).toString("base64url");
    const csrf = randomBytes(24).toString("base64url");
    sessions.set(token, { csrf, expiresAt: Date.now() + SESSION_MS });
    reply.header("set-cookie", `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=43200`);
    return { status: "ok", csrf };
  });
  app.post("/api/admin/v1/logout", async (request, reply) => {
    if (!requireAdmin(request, reply, true)) return;
    const token = request.headers.cookie?.match(/(?:^|;\s*)cwapi_admin=([A-Za-z0-9_-]+)/)?.[1];
    if (token) sessions.delete(token);
    reply.header("set-cookie", `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=0`);
    return { status: "ok" };
  });
  app.get("/api/admin/v1/overview", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    return { ...store.summary(), bridge: bridgeStatus(), tunnel: tunnelStatus(), endpoint: "http://127.0.0.1:" + (process.env.PORT ?? "3211") };
  });
  const liveClients = new Map<Session, number>();
  const closeLive = new Set<() => void>();
  app.addHook('preClose', async () => { for (const close of closeLive) close(); });
  app.get('/api/admin/v1/events', async (request, reply) => {
    const session = requireAdmin(request, reply);
    if (!session) return;
    if (!validOrigin(request)) return reply.code(403).send({ error: 'csrf_failed' });
    if ((liveClients.get(session) ?? 0) >= 8) return reply.code(429).send({ error: 'live_connection_limit' });
    liveClients.set(session, (liveClients.get(session) ?? 0) + 1);
    reply.hijack();
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-store', 'x-accel-buffering': 'no' });
    let last = '', closed = false;
    const close = () => {
      if (closed) return;
      closed = true; clearInterval(timer); closeLive.delete(close);
      const count = (liveClients.get(session) ?? 1) - 1;
      if (count) liveClients.set(session, count); else liveClients.delete(session);
      if (!reply.raw.destroyed) reply.raw.end();
    };
    const tick = () => {
      if (sessionFor(request) !== session) { close(); return; }
      const event = JSON.stringify({ revision: store.revision, overview: { ...store.summary(), bridge: bridgeStatus(), tunnel: tunnelStatus(), endpoint: 'http://127.0.0.1:' + (process.env.PORT ?? '3211') } });
      if (reply.raw.writableLength > 65536) { close(); return; }
      if (last !== event) { last = event; reply.raw.write('event: update\ndata: ' + event + '\n\n'); }
      else reply.raw.write(': heartbeat\n\n');
    };
    const timer = setInterval(tick, 1000); timer.unref();
    closeLive.add(close); reply.raw.once('close', close); tick();
  });
  app.get('/api/admin/v1/tunnel', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    return tunnelAdmin?.metadata() ?? { binaryPath: '', tunnelId: '', hasRuntimeKey: false, enabled: false, status: tunnelStatus(), canInstall: false, available: false };
  });
  const tunnelAccess = (request: FastifyRequest, reply: FastifyReply): boolean => {
    if (!requireAdmin(request, reply, true)) return false;
    // Running/installing local executables never becomes a remote-admin feature.
    if (!localClient(request)) { reply.code(403).send({ error: 'local_only' }); return false; }
    try { if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL('http://' + request.headers.host).hostname)) throw new Error(); }
    catch { reply.code(403).send({ error: 'local_only' }); return false; }
    if (!tunnelAdmin) { reply.code(503).send({ error: 'tunnel_admin_unavailable' }); return false; }
    return true;
  };
  app.put('/api/admin/v1/tunnel', async (request, reply) => {
    if (!tunnelAccess(request, reply)) return;
    const parsed = z.object({ binaryPath: z.string().trim().min(1).max(2048), tunnelId: z.string().trim().regex(/^tunnel_[a-f0-9]{32}$/), runtimeApiKey: z.string().trim().min(20).max(16384).optional(), enabled: z.boolean() }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'tunnel_settings_invalid' });
    try { return await tunnelAdmin!.save(parsed.data); }
    catch (error) { return reply.code(400).send({ error: safeTunnelError(error) }); }
  });
  for (const action of ['start', 'stop', 'test', 'install'] as const) app.post('/api/admin/v1/tunnel/' + action, async (request, reply) => {
    if (!tunnelAccess(request, reply)) return;
    try { return await tunnelAdmin![action](); }
    catch (error) { return reply.code(400).send({ error: safeTunnelError(error) }); }
  });
  app.get("/api/admin/v1/api-keys", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    return { keys: store.listKeys() };
  });
  app.post("/api/admin/v1/api-keys", async (request, reply) => {
    if (!requireAdmin(request, reply, true)) return;
    const parsed = z.object({ name: z.string().trim().min(1).max(80) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_name" });
    return reply.code(201).send(store.createKey(parsed.data.name));
  });
  app.delete("/api/admin/v1/api-keys/:id", async (request, reply) => {
    if (!requireAdmin(request, reply, true)) return;
    const id = (request.params as { id: string }).id;
    return store.revokeKey(id) ? { status: "revoked" } : reply.code(404).send({ error: "not_found" });
  });
  app.get("/api/admin/v1/models", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    return { models: store.listModels() };
  });
  app.get("/api/admin/v1/providers", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    return { providers: store.listProviders() };
  });
  app.put("/api/admin/v1/providers/:id", async (request, reply) => {
    if (!requireAdmin(request, reply, true)) return;
    const id = (request.params as { id: string }).id;
    const parsed = z.object({ name: z.string().trim().min(1).max(120), type: z.enum(["coworker-widget", "openai", "anthropic", "openai-compatible"]), baseUrl: z.string().max(2048).optional(), wireApi: z.enum(["responses", "chat-completions"]).optional(), enabled: z.boolean(), apiKey: z.string().min(1).max(16384).optional() }).safeParse(request.body);
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(id) || !parsed.success) return reply.code(400).send({ error: "invalid_provider" });
    try {
      const { apiKey, ...provider } = parsed.data;
      if (provider.type !== "coworker-widget") providerBaseUrl(provider.baseUrl ?? "");
      store.upsertProvider({ id, ...provider }, apiKey);
      return { status: "saved" };
    } catch (error) {
      // Errors here are local validation/encryption errors, never upstream bodies.
      return reply.code(400).send({ error: error instanceof Error ? error.message : "invalid_provider" });
    }
  });
  app.post("/api/admin/v1/providers/:id/test", async (request, reply) => {
    if (!requireAdmin(request, reply, true)) return;
    const provider = store.listProviders().find((item) => item.id === (request.params as { id: string }).id);
    if (!provider) return reply.code(404).send({ error: "provider_not_found" });
    if (!provider.enabled) return reply.code(409).send({ error: "provider_disabled" });
    if (provider.type === "coworker-widget") return { connection: bridgeStatus() === "ready" ? "ok" : "not_connected", authentication: "mcp", models: ["chatgpt-web"] };
    try {
      const key = store.providerKey(provider.id);
      if (!key) return reply.code(409).send({ error: "provider_credential_missing" });
      return await probeProvider(provider, key);
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : "provider_test_failed" });
    }
  });
  app.put("/api/admin/v1/models/:id", async (request, reply) => {
    if (!requireAdmin(request, reply, true)) return;
    const id = (request.params as { id: string }).id;
    const parsed = z.object({ provider: z.string().regex(/^[A-Za-z0-9._-]{1,120}$/), upstreamModel: z.string().trim().min(1).max(120), enabled: z.boolean(), supportsTools: z.boolean(), supportsStreaming: z.boolean() }).safeParse(request.body);
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(id) || !parsed.success) return reply.code(400).send({ error: "invalid_model" });
    const provider = store.listProviders().find((item) => item.id === parsed.data.provider);
    if (parsed.data.provider !== "coworker-widget" && (!provider || (provider.type !== "coworker-widget" && !["openai", "openai-compatible", "anthropic"].includes(provider.type)))) return reply.code(400).send({ error: "provider_adapter_unavailable" });
    store.upsertModel({ id, ...parsed.data });
    return { status: "saved" };
  });
  app.get("/api/admin/v1/requests", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    return { requests: store.listRequests().slice(0, 100) };
  });
  app.get("/api/admin/v1/usage", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    return store.usage();
  });
  app.delete("/api/admin/v1/requests", async (request, reply) => {
    if (!requireAdmin(request, reply, true)) return;
    return { status: "cleared", deletedRequests: store.clearRequests() };
  });
  app.delete("/api/admin/v1/usage", async (request, reply) => {
    if (!requireAdmin(request, reply, true)) return;
    return { status: "cleared", ...store.clearUsage() };
  });
  app.get("/api/admin/v1/limits", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    if (!limits) return reply.code(503).send({ error: "limits_unavailable" });
    return { requestsPerMinute: limits.requestsPerMinute, concurrentRequests: limits.concurrentRequests, scope: "per-key-single-process" };
  });
  app.put("/api/admin/v1/limits", async (request, reply) => {
    if (!requireAdmin(request, reply, true)) return;
    if (!limits) return reply.code(503).send({ error: "limits_unavailable" });
    const parsed = z.object({ requestsPerMinute: z.number().int().min(1).max(100_000), concurrentRequests: z.number().int().min(1).max(1000) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_limits" });
    store.setLimits(parsed.data);
    limits.configure(parsed.data.requestsPerMinute, parsed.data.concurrentRequests);
    return { status: "saved" };
  });
}

function safeTunnelError(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return /^tunnel_[a-z_]+$/.test(code) ? code : 'tunnel_operation_failed';
}

const DASHBOARD_HTML = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CoworkerAPI</title><style>
:root{font-family:Inter,system-ui,Segoe UI,sans-serif;color:#e7edf3;background:#0b1118}*{box-sizing:border-box}body{margin:0}button,input{font:inherit}button{cursor:pointer}a{color:inherit}.layout{display:grid;grid-template-columns:230px 1fr;min-height:100vh}.sidebar{background:#101923;border-right:1px solid #263442;padding:24px 16px}.brand{font-weight:800;font-size:20px;letter-spacing:-.04em;margin:0 0 30px 8px}.brand span{color:#67d6aa}.nav{display:grid;gap:5px}.nav button{width:100%;border:0;border-radius:10px;text-align:left;background:transparent;color:#aab9c8;padding:11px 13px}.nav button.active,.nav button:hover{color:white;background:#223347}.sidefoot{position:fixed;bottom:22px;color:#7f92a4;font-size:12px;padding-left:10px}.main{padding:28px;max-width:1300px;width:100%}.top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:23px}.top h1{margin:0;font-size:28px;letter-spacing:-.035em}.sub{color:#98aabb;font-size:13px;margin-top:5px}.panel,.metric{background:#121e2b;border:1px solid #293949;border-radius:16px;padding:20px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px}.metric label{display:block;color:#91a5b8;font-size:12px}.metric strong{display:block;font-size:27px;margin-top:7px}.grid{display:grid;grid-template-columns:1.2fr .8fr;gap:18px}.panel h2{margin:0 0 16px;font-size:16px}.row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid #293949}.row:last-child{border:0}.muted{color:#91a5b8}.pill{border-radius:999px;padding:5px 10px;font-size:12px;background:#263949;color:#b9d8e6}.pill.ok{background:#123b30;color:#7ce2b4}.pill.bad{background:#4a2b32;color:#ffb2be}.primary,.secondary,.danger{border:1px solid #6cd6aa;border-radius:9px;padding:9px 13px;background:#6cd6aa;color:#08231a;font-weight:700}.secondary{background:transparent;color:#cbe8dd;border-color:#416555}.danger{background:transparent;color:#ffb2be;border-color:#77414b}.input{background:#0d1721;border:1px solid #365065;color:white;border-radius:9px;padding:10px 12px;min-width:220px;outline:none}.input:focus{border-color:#6cd6aa}.form{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0}.notice{color:#a9bed0;line-height:1.5}.secret{word-break:break-all;background:#071019;border:1px solid #365065;border-radius:10px;padding:12px;margin:12px 0;color:#8ff4c2}.hidden{display:none!important}table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:11px;border-bottom:1px solid #293949}th{color:#91a5b8;font-weight:500}.auth{max-width:430px;margin:12vh auto}.auth h1{font-size:30px}#message{min-height:22px;color:#ffadad;margin-top:12px}@media(max-width:850px){.layout{grid-template-columns:1fr}.sidebar{padding:13px;display:flex;align-items:center;gap:16px;overflow:auto}.brand{margin:0}.nav{display:flex}.nav button{white-space:nowrap}.sidefoot{display:none}.main{padding:18px}.metrics{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}}@media(max-width:520px){.metrics{grid-template-columns:1fr 1fr}.metric{padding:14px}.metric strong{font-size:21px}.top h1{font-size:23px}}
${DASHBOARD_STYLE}
${DASHBOARD_SHELL}
let csrf='';let page='overview';const $=id=>document.getElementById(id);const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
${DASHBOARD_I18N_SCRIPT}
const bridgeLabel=status=>status==='ready'?t("ui.connected"):['widget_not_connected','bridge_not_connected'].includes(status)?t("ui.waiting_for_connection"):status==='configured'?t('status.configured'):status;
function updateBridge(o){for(const id of ['bridge','bridge-detail']){const el=$(id);if(el){if(el.dataset)el.dataset.bridgeState=o.bridge;el.textContent=bridgeLabel(o.bridge);el.className='pill '+(o.bridge==='ready'?'ok':'bad')}}const hint=$('bridge-hint');if(hint)hint.textContent=o.bridge==='ready'?t("ui.the_widget_is_connected_to_the_gateway_keep_the"):t("ui.connect_the_plugin_to_coworkerapi_open_the_bridge_in");const tunnel=$('tunnel-detail');if(tunnel){if(tunnel.dataset)tunnel.dataset.tunnelState=o.tunnel.state;tunnel.textContent=tunnelStateLabel(o.tunnel.state);tunnel.className='pill '+(o.tunnel.state==='running'?'ok':'bad')}}
${DASHBOARD_LIVE_SCRIPT}
async function api(path,options={}){const headers=new Headers(options.headers);headers.set('x-coworker-csrf',csrf);if(options.body!==undefined&&!headers.has('content-type'))headers.set('content-type','application/json');const r=await fetch('/api/admin/v1/'+path,{credentials:'same-origin',...options,headers});const data=await r.json();if(!r.ok)throw Error(data.error||'Request failed');return data}
const friendlyError=code=>({invalid_credentials:t("ui.incorrect_password_enter_your_admin_password_again"),invalid_password:t("ui.the_password_must_contain_6_to_256_characters"),login_required:t("ui.your_session_has_expired_sign_in_again_to_continue"),csrf_failed:t("ui.invalid_session_reload_the_page_and_try_again"),local_only:t("ui.this_action_is_only_available_on_the_machine_running"),invalid_name:t("ui.enter_an_api_key_name_with_1_to_80"),invalid_model:t("ui.check_the_model_id_provider_and_upstream_model"),invalid_provider:t("ui.check_the_provider_id_type_and_endpoint"),invalid_limits:t("ui.enter_a_per_minute_limit_from_1_to_100"),provider_disabled:t("ui.this_provider_is_disabled_enable_it_before_testing_the"),provider_credential_missing:t("ui.this_provider_has_no_api_key_save_a_key"),provider_adapter_unavailable:t("ui.no_supported_adapter_is_available_for_this_provider"),not_found:t("ui.the_requested_item_was_not_found_refresh_the_page"),limits_unavailable:t("ui.this_gateway_instance_does_not_support_limit_management")}[code]||code);
let feedbackTimer;
function notify(message){const el=$('feedback');if(!el)return;el.textContent=message;el.classList.remove('hidden');clearTimeout(feedbackTimer);feedbackTimer=setTimeout(()=>el.classList.add('hidden'),3500)}
function confirmAction(titleKey,bodyKey,acceptKey){return new Promise(resolve=>{
const dialog=$('confirm-dialog');dialog.returnValue='cancel';
for(const [id,key] of [['confirm-title',titleKey],['confirm-description',bodyKey],['confirm-accept',acceptKey]]){const el=$(id);el.dataset.i18n=key;el.textContent=t(key)}
$('confirm-cancel').onclick=()=>dialog.close('cancel');$('confirm-accept').onclick=()=>dialog.close('accept');dialog.onclose=()=>resolve(dialog.returnValue==='accept');dialog.showModal()
})}
function confirmRevoke(){return confirmAction('ui.revoke_api_key','ui.after_revocation_this_key_cannot_authenticate_new_requests_this','ui.revoke_key')}
function bindCleanup(kind,empty){
const button=$('clear-'+kind);if(!button)return;button.disabled=empty;
button.onclick=async()=>{
if(!await confirmAction('cleanup.'+kind+'.title','cleanup.'+kind+'.body','cleanup.'+kind+'.button'))return;
button.disabled=true;button.dataset.busy='true';
try{await api(kind==='logs'?'requests':'usage',{method:'DELETE'});await render();notify(t('cleanup.'+kind+'.success'))}
catch(error){notify(friendlyError(error.message))}
finally{button.disabled=empty;delete button.dataset.busy}
}
}
try{const theme=localStorage.getItem('coworkerapi-theme');if(theme==='light')document.documentElement.dataset.theme='light'}catch{}

async function init(){try{const s=await api('session');$('auth-hint').textContent=s.initialized?t("ui.default_password_123456_if_you_have_changed_it_enter"):t("ui.set_an_admin_password_with_at_least_6_characters");if(s.loggedIn){csrf=s.csrf;showApp()}else{$('auth').classList.remove('hidden');$('app').classList.add('hidden')}}catch(err){$('auth').classList.remove('hidden');$('message').textContent=friendlyError(err.message)}}
$('auth-form').onsubmit=async e=>{e.preventDefault();$('message').textContent='';const button=e.submitter;if(button){button.disabled=true;button.textContent=t("ui.signing_in")}try{const password=$('password').value;const s=await api('session');if(!s.initialized)await api('setup',{method:'POST',body:JSON.stringify({password})});const login=await api('login',{method:'POST',body:JSON.stringify({password})});csrf=login.csrf;$('password').value='';showApp()}catch(err){$('message').textContent=friendlyError(err.message)}finally{if(button){button.disabled=false;button.textContent=t("ui.sign_in")}}};
function showApp(){$('auth').classList.add('hidden');$('app').classList.remove('hidden');render().then(()=>{dashboardTour.autoStart();startDashboardLive()})}
async function renderUsage(background=false,guard=()=>true){
const data=await api('usage');if(!guard())return;const content=background?document.createElement('div'):$('content');
const days=[...data.days].sort((a,b)=>a.day.localeCompare(b.day));const recent=days.slice(-14);const requests=days.reduce((sum,d)=>sum+d.requests,0);const errors=days.reduce((sum,d)=>sum+d.errors,0);const maxRequests=Math.max(1,...recent.map(d=>d.requests));
const chart=recent.length?("<div class=\\"usage-chart\\" role=\\"img\\" aria-label=\\""+t("ui.request_count_for"))+recent.length+(t("ui.most_recent_days_with_data_detailed_metrics_are_listed")+"\\">")+recent.map(d=>'<div class="chart-column"><div class="chart-bar" style="height:'+Math.max(1,d.requests/maxRequests*100)+'%" title="'+esc(d.day)+': '+esc(d.requests)+' requests"></div></div>').join('')+'</div><div class="chart-caption"><span>'+esc(recent[0].day)+'</span><span>'+esc(recent[recent.length-1].day)+'</span></div>':("<div class=\\"empty\\">"+${JSON.stringify(dashboardIcon('usage'))}+"<strong>"+t("ui.no_usage_data")+"</strong><p>"+t("ui.activity_appears_here_when_a_tool_sends_requests_through")+"</p></div>");
const measurement=m=>m.sum===null?'— ('+m.unknown+(" "+t("ui.unknown")+")"):esc(m.sum)+'<div class="muted">'+m.known+(" "+t("ui.known")+" / ")+m.unknown+(" "+t("ui.unknown")+"</div>");
const coverage=data.coverage==='since-reset'?t('cleanup.usage.coverage'):data.coverage==='since-store-created'?t("ui.aggregated_since_the_data_store_was_created"):t("ui.pre_upgrade_data_includes_only_retained_logs_not_the");
content.innerHTML=("<section class=\\"panel\\"><h2>"+t("ui.daily_usage_utc")+"</h2><p class=\\"notice\\">")+esc(coverage)+("</p><p class=\\"notice\\">"+t("ui.metrics_are_aggregated_by_utc_day_independently_of_the")+"</p><details><summary>"+t("ui.understanding_metrics")+"</summary><p class=\\"notice\\">"+t("ui.totals_include_measured_values_only_a_dash_indicates_unknown")+"</p></details><div style=\\"overflow:auto\\"><table><thead><tr><th>"+t("ui.date")+"</th><th>"+t("ui.requests_errors")+"</th><th>"+t("ui.average_latency")+"</th><th>Input</th><th>Cache read / write</th><th>Output</th><th>Reasoning</th><th>"+t("ui.known_cost_usd")+"</th></tr></thead><tbody>")+data.days.map(d=>'<tr><td>'+esc(d.day)+'</td><td>'+esc(d.requests)+' / '+esc(d.errors)+'</td><td>'+(d.averageLatencyMs===null?'—':esc(d.averageLatencyMs)+' ms')+'</td><td>'+measurement(d.measurements.inputTokens)+'</td><td>'+measurement(d.measurements.cachedInputTokens)+' / '+measurement(d.measurements.cacheWriteInputTokens)+'</td><td>'+measurement(d.measurements.outputTokens)+'</td><td>'+measurement(d.measurements.reasoningTokens)+'</td><td>'+measurement(d.measurements.costEstimateUsd)+'</td></tr>').join('')+'</tbody></table></div></section>';
const summary=("<div class=\\"metrics usage-summary\\"><div class=\\"metric\\"><label>"+t("ui.total_requests")+"</label><strong>")+esc(requests)+("</strong><small>"+t("ui.in_stored_data")+"</small></div><div class=\\"metric\\"><label>"+t("ui.total_errors")+"</label><strong>")+esc(errors)+("</strong><small>"+t("ui.unsuccessful_requests")+"</small></div><div class=\\"metric\\"><label>"+t("ui.days_with_data")+"</label><strong>")+esc(days.length)+("</strong><small>"+t("ui.utc_days")+"</small></div><div class=\\"metric\\"><label>"+t("ui.unknown_cost_tokens")+"</label><strong>—</strong><small>"+t("ui.not_counted_as_zero")+"</small></div></div><section class=\\"panel\\" style=\\"margin-bottom:24px\\"><div class=\\"section-head\\"><div><h2>"+t("ui.gateway_activity")+"</h2><p class=\\"notice\\">"+t("ui.daily_requests_up_to_14_most_recent_days_with")+"</p></div></div>")+chart+'</section>';
content.innerHTML='<div class="page-actions"><button id="clear-usage" class="secondary cleanup-button" type="button">'+${JSON.stringify(dashboardIcon('trash'))}+'<span>'+t('cleanup.usage.button')+'</span></button></div>'+summary+content.innerHTML;if(background){const button=content.querySelector('#clear-usage');if(button)button.disabled=days.length===0;commitLivePage(content,'usage',guard);return;}bindCleanup('usage',days.length===0);
}
async function renderLimits(){const data=await api('limits');$('content').innerHTML=("<section class=\\"panel\\"><h2>"+t("ui.request_limits")+"</h2><p class=\\"notice\\">"+t("ui.control_request_frequency_and_concurrency_for_each_api_key")+"</p><p class=\\"notice\\">"+t("ui.changes_are_saved_and_apply_immediately_to_new_requests")+"</p><p class=\\"notice\\"><strong>"+t("ui.scope")+"</strong> "+t("ui.these_are_gateway_limits_not_your_chatgpt_account_quota")+"</p><form id=\\"limits-form\\" class=\\"form\\"><label>"+t("ui.requests_per_minute")+" <input id=\\"limits-rpm\\" class=\\"input\\" type=\\"number\\" min=\\"1\\" max=\\"100000\\" required></label><label>"+t("ui.concurrent_requests")+" <input id=\\"limits-concurrent\\" class=\\"input\\" type=\\"number\\" min=\\"1\\" max=\\"1000\\" required></label><button class=\\"primary\\">"+t("ui.save_limits")+"</button></form><p id=\\"limits-result\\" class=\\"notice\\"></p></section>");$('limits-rpm').value=data.requestsPerMinute;$('limits-concurrent').value=data.concurrentRequests;$('limits-form').onsubmit=async e=>{e.preventDefault();try{await api('limits',{method:'PUT',body:JSON.stringify({requestsPerMinute:Number($('limits-rpm').value),concurrentRequests:Number($('limits-concurrent').value)})});$('limits-result').textContent=t("ui.saved_the_new_policy_is_effective_immediately")}catch(err){$('limits-result').textContent=friendlyError(err.message)}}}
document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{page=b.dataset.page;document.querySelectorAll('[data-page]').forEach(x=>{x.classList.toggle('active',x===b);if(x===b)x.setAttribute('aria-current','page');else x.removeAttribute('aria-current')});render()});
let renderGeneration=0;
async function render(){
const generation=++renderGeneration;const selected=page;
const names={overview:t("ui.overview"),connections:t("ui.connections"),usage:'Usage',models:'Models',keys:'API keys',providers:'Providers',logs:t("ui.logs"),limits:t("ui.limits"),settings:t("ui.settings")};
$('title').textContent=names[selected];$('content').innerHTML=("<div class=\\"loading\\">"+t("ui.loading_data")+"</div>");
try{const o=await api('overview');if(generation!==renderGeneration)return;updateBridge(o);
if(selected==='overview'){
$('content').innerHTML=("<div class=\\"banner\\"><div><strong>"+t("ui.gateway_for_cli_tools")+"</strong><p>"+t("ui.use_chatgpt_mcp_widget_through_openai_compatible_and_anthropic")+"</p></div><span class=\\"pill\\">Local workspace</span></div>")+
("<div class=\\"metrics\\"><div class=\\"metric\\"><label>"+t("ui.requests_today")+"</label><strong>")+esc(o.requestsToday)+("</strong><small>"+t("ui.requests_recorded_by_the_gateway")+"</small></div><div class=\\"metric\\"><label>"+t("ui.active_api_keys")+"</label><strong>")+esc(o.activeKeys)+("</strong><small>"+t("ui.keys_that_have_not_been_revoked")+"</small></div><div class=\\"metric\\"><label>"+t("ui.errors_today")+"</label><strong>")+esc(o.errorsToday)+("</strong><small>"+t("ui.requests_that_did_not_complete_successfully")+"</small></div><div class=\\"metric\\"><label>"+t("ui.average_latency")+"</label><strong>")+esc(o.averageLatencyMs)+("<span style=\\"font-size:14px;letter-spacing:0\\"> ms</span></strong><small>"+t("ui.request_processing_time")+"</small></div></div>")+
("<div class=\\"grid\\"><section class=\\"panel\\"><div class=\\"eyebrow\\">"+t("ui.connections")+"</div><h2>ChatGPT bridge</h2><p class=\\"notice\\">"+t("ui.forward_requests_between_the_cli_and_the_chatgpt_widget")+"</p><div class=\\"row\\"><span>ChatGPT MCP widget</span><span id=\\"bridge-detail\\" class=\\"pill ")+(o.bridge==='ready'?'ok':'bad')+'">'+esc(bridgeLabel(o.bridge))+'</span></div><div class="row"><span>Secure MCP tunnel</span><span id="tunnel-detail" class="pill '+(o.tunnel.state==='running'?'ok':'bad')+'">'+esc(tunnelStateLabel(o.tunnel.state))+("</span></div><p id=\\"bridge-hint\\" class=\\"notice\\" style=\\"margin-top:20px\\">"+t("ui.open_the_bridge_in_chatgpt_and_send_the_prefilled")+"</p><a class=\\"primary\\" href=\\"${BRIDGE_ACTIVATION_URL}\\" target=\\"_blank\\" rel=\\"noopener noreferrer\\">"+t("ui.open_bridge_in_chatgpt")+" "+${JSON.stringify(dashboardIcon('arrow'))}+"</a></section>")+
("<section class=\\"panel\\"><div class=\\"eyebrow\\">"+t("ui.get_started")+"</div><h2>Endpoint local</h2><div class=\\"secret endpoint-box\\"><code>")+esc(o.endpoint)+'/v1</code><button class="icon-button" data-copy="'+esc(o.endpoint)+("/v1\\" aria-label=\\""+t("ui.copy_endpoint")+"\\" title=\\""+t("ui.copy_endpoint")+"\\">"+${JSON.stringify(dashboardIcon('copy'))}+"</button></div><ol class=\\"steps\\"><li><span class=\\"step-num\\">1</span><div><strong>"+t("ui.connect_the_bridge")+"</strong>"+t("ui.configure_the_tunnel_and_plugin_on_the_connections_page")+"</div></li><li><span class=\\"step-num\\">2</span><div><strong>"+t("ui.create_an_api_key")+"</strong>"+t("ui.create_a_separate_key_for_each_tool_on_the")+"</div></li><li><span class=\\"step-num\\">3</span><div><strong>"+t("ui.configure_cli_tools")+"</strong>"+t("ui.see_endpoint_and_authentication_settings_for_each_tool_on")+"</div></li></ol></section></div>");
updateBridge(o);
}
if(selected==='connections')await renderConnections();if(selected==='keys')await renderKeys();if(selected==='models')await renderModels();if(selected==='logs')await renderLogs();if(selected==='providers')await renderProviders();if(selected==='usage')await renderUsage();if(selected==='limits')await renderLimits();
if(selected==='settings'){
const copyIcon=${JSON.stringify(dashboardIcon('copy'))};
function endpointCard(protocol,base,description,paths,auth){
return '<section class="panel endpoint-card"><h2>'+protocol+'-compatible endpoint</h2><p class="notice">'+t(description)+'</p><div class="code-label">'+t('settings.base_url')+'</div><div class="secret endpoint-box"><code>'+esc(base)+'</code><button class="icon-button" type="button" data-copy="'+esc(base)+'" aria-label="'+esc(t('ui.copy_endpoint'))+'" title="'+esc(t('ui.copy_endpoint'))+'">'+copyIcon+'</button></div><div class="code-label">API</div><pre class="secret">'+paths+'</pre><div class="code-label">'+t('settings.api_key')+'</div><pre class="secret">'+auth+'</pre></section>'
}
$('content').innerHTML='<p class="notice">'+t('settings.authentication')+'</p><div class="grid">'+endpointCard('Anthropic',o.endpoint,'settings.anthropic.description','POST /v1/messages','x-api-key: &lt;API_KEY&gt;')+endpointCard('OpenAI',o.endpoint+'/v1','settings.openai.description','POST /responses<br>POST /chat/completions','Authorization: Bearer &lt;API_KEY&gt;')+'</div><div class="settings-footer"><p class="notice">'+t('ui.signing_out_ends_your_admin_session_the_gateway_keeps')+'</p><button id="logout" class="secondary">'+t('ui.sign_out')+'</button></div>';
$('logout').onclick=async()=>{await api('logout',{method:'POST',body:'{}'});csrf='';init()};
}

enhanceContent();
}catch(err){if(generation!==renderGeneration)return;$('content').innerHTML=("<section class=\\"panel\\"><h2>"+t("ui.unable_to_load_data")+"</h2><p class=\\"notice\\" role=\\"alert\\">")+esc(friendlyError(err.message))+("</p><button id=\\"retry-page\\" class=\\"secondary\\">"+t("ui.try_again")+"</button></section>");if($('retry-page'))$('retry-page').onclick=render;if(err.message==='login_required'){csrf='';init()}}
}
function enhanceContent(){
const labels={'key-name':t("ui.api_key_name"),'model-id':t("ui.public_model_id"),'model-provider':'Provider','upstream-model':'Upstream model','provider-id':'Provider ID','provider-name':t("ui.provider_name"),'provider-type':t("ui.provider_type"),'provider-url':'Base URL','provider-key':t("ui.provider_api_key"),'provider-wire':'Wire API'};
document.querySelectorAll('#content .input').forEach(input=>{if(!labels[input.id]||input.closest('label')||input.previousElementSibling?.tagName==='LABEL')return;const wrap=document.createElement('div');wrap.className='field';const label=document.createElement('label');label.htmlFor=input.id;label.textContent=labels[input.id];input.parentNode.insertBefore(wrap,input);wrap.append(label,input)});
document.querySelectorAll('#content table').forEach(table=>{table.setAttribute('aria-label',$('title').textContent);table.parentElement.classList.add('table-wrap');table.querySelectorAll('th').forEach(th=>th.setAttribute('scope','col'))});
document.querySelectorAll('[data-copy]').forEach(button=>button.onclick=async()=>{try{await navigator.clipboard.writeText(button.dataset.copy);notify(t("ui.endpoint_copied"))}catch{notify(t("ui.clipboard_access_is_unavailable_select_the_endpoint_and_copy"))}});
document.querySelectorAll('#content form').forEach(form=>{if(!form.onsubmit||form.dataset.pendingWrapper)return;form.dataset.pendingWrapper='true';const handler=form.onsubmit;form.onsubmit=async event=>{event.preventDefault();const button=event.submitter;const text=button?.textContent;form.dataset.busy='true';if(button){button.disabled=true;button.textContent=t("ui.processing")}try{await handler.call(form,event)}catch(err){notify(friendlyError(err.message))}finally{delete form.dataset.busy;if(button){button.disabled=false;button.textContent=text}}}});
}
if(typeof MutationObserver!=='undefined')new MutationObserver(enhanceContent).observe($('content'),{childList:true,subtree:true});
async function renderKeys(){const data=await api('api-keys');$('content').innerHTML=("<section class=\\"panel\\"><h2>API keys</h2><p class=\\"notice\\">"+t("ui.create_and_revoke_authentication_keys_for_coworkerapi_use_a")+"</p><p class=\\"notice\\">"+t("ui.keys_are_shown_only_once_after_creation_coworkerapi_stores")+"</p><form id=\\"key-form\\" class=\\"form\\"><input id=\\"key-name\\" class=\\"input\\" placeholder=\\""+t("ui.example_claude_code")+"\\" required maxlength=\\"80\\"><button class=\\"primary\\">"+t("ui.create_key")+"</button><div id=\\"key-error\\" class=\\"form-error\\" role=\\"alert\\"></div></form><div id=\\"new-key\\"></div><div id=\\"key-list\\"></div></section>");$('key-list').innerHTML=data.keys.length?data.keys.map(k=>'<div class="row"><div><strong>'+esc(k.name)+'</strong><div class="muted">'+esc(k.prefix)+'… · '+esc(k.lastUsedAt||t("ui.never_used"))+'</div></div><div>'+ (k.revokedAt?("<span class=\\"pill bad\\">"+t("ui.revoked")+"</span>"):'<button class="danger" data-revoke="'+esc(k.id)+("\\">"+t("ui.revoke")+"</button>"))+'</div></div>').join(''):("<div class=\\"empty\\">"+${JSON.stringify(dashboardIcon('keys'))}+"<strong>"+t("ui.no_api_keys")+"</strong><p>"+t("ui.select_create_key_to_configure_authentication_for_a_cli")+"</p></div>");$('key-form').onsubmit=async e=>{e.preventDefault();$('key-error').textContent='';try{const x=await api('api-keys',{method:'POST',body:JSON.stringify({name:$('key-name').value})});await renderKeys();$('new-key').innerHTML='<div class="secret">'+esc(x.key)+("</div><p class=\\"notice\\">"+t("ui.copy_the_key_and_store_it_securely_you_cannot")+"</p>")}catch(err){$('key-error').textContent=friendlyError(err.message)}};document.querySelectorAll('[data-revoke]').forEach(b=>b.onclick=async()=>{if(!await confirmRevoke())return;b.disabled=true;try{await api('api-keys/'+b.dataset.revoke,{method:'DELETE'});await renderKeys();notify(t("ui.api_key_revoked"))}catch(err){b.disabled=false;notify(friendlyError(err.message))}})}
async function renderModels(){
const [data,providerData]=await Promise.all([api('models'),api('providers')]);
const availableProviders=[{id:'coworker-widget',name:'ChatGPT MCP/widget'},...(providerData.providers||[]).filter(p=>p.id!=='coworker-widget'&&['coworker-widget','openai','openai-compatible','anthropic'].includes(p.type))];
$('content').innerHTML=("<section class=\\"panel\\"><h2>Model aliases</h2><p class=\\"notice\\">"+t("ui.map_the_model_id_used_by_your_cli_to")+"</p><p class=\\"notice\\">"+t("ui.for_mcp_widget_an_alias_does_not_change_the")+"</p><details><summary>"+t("ui.compatibility_limits")+"</summary><p class=\\"notice\\">"+t("ui.widget_sse_waits_for_the_complete_callback_api_providers")+"</p></details><form id=\\"model-form\\" class=\\"form\\"><input id=\\"model-id\\" class=\\"input\\" placeholder=\\"Public model ID\\" required><select id=\\"model-provider\\" class=\\"input\\">")+availableProviders.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+' · '+esc(p.id)+'</option>').join('')+("</select><input id=\\"upstream-model\\" class=\\"input\\" value=\\"chatgpt-web\\" placeholder=\\"Upstream model\\" required><label><input id=\\"model-enabled\\" type=\\"checkbox\\" checked> "+t("ui.enabled")+"</label><label><input id=\\"model-tools\\" type=\\"checkbox\\" checked> Tools</label><label><input id=\\"model-streaming\\" type=\\"checkbox\\" checked> SSE</label><button class=\\"primary\\">"+t("ui.save_alias")+"</button></form><p id=\\"model-result\\" class=\\"notice\\"></p><div id=\\"model-list\\"></div></section>");
$('model-provider').value='coworker-widget';
$('model-list').innerHTML=data.models.map(m=>'<div class="row"><div><strong>'+esc(m.id)+'</strong><div class="muted">'+esc(m.provider)+' → '+esc(m.upstreamModel)+' · Tools: '+(m.supportsTools?t("ui.yes"):t("ui.no"))+' · SSE: '+(m.supportsStreaming?t("ui.yes"):t("ui.no"))+'</div></div><div><span class="pill '+(m.enabled?'ok':'bad')+'">'+(m.enabled?t("ui.enabled_2"):t("ui.disabled"))+'</span> <button class="secondary" data-edit-model="'+esc(m.id)+("\\">"+t("ui.edit")+"</button></div></div>")).join('');
$('model-form').onsubmit=async e=>{e.preventDefault();try{const id=$('model-id').value.trim();await api('models/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({provider:$('model-provider').value,upstreamModel:$('upstream-model').value.trim(),enabled:$('model-enabled').checked,supportsTools:$('model-tools').checked,supportsStreaming:$('model-streaming').checked})});await renderModels();$('model-result').textContent=t("ui.alias_saved_the_configuration_applies_to_the_next_request")}catch(err){$('model-result').textContent=friendlyError(err.message)}};
document.querySelectorAll('[data-edit-model]').forEach(b=>b.onclick=()=>{const m=data.models.find(x=>x.id===b.dataset.editModel);if(!m)return;if(!availableProviders.some(p=>p.id===m.provider)){$('model-result').textContent=t("ui.no_supported_adapter_is_available_for_this_provider_the");return}$('model-id').value=m.id;$('model-provider').value=m.provider;$('upstream-model').value=m.upstreamModel;$('model-enabled').checked=m.enabled;$('model-tools').checked=m.supportsTools;$('model-streaming').checked=m.supportsStreaming});
}
async function renderLogs(background=false,guard=()=>true){
const data=await api('requests');if(!guard())return;const content=background?document.createElement('div'):$('content');
const value=x=>x===null||x===undefined?'—':esc(x);
content.innerHTML='<div class="page-actions"><button id="clear-logs" class="secondary cleanup-button" type="button">'+${JSON.stringify(dashboardIcon('trash'))}+'<span>'+t('cleanup.logs.button')+'</span></button></div>'+("<section class=\\"panel\\"><h2>"+t("ui.100_most_recent_requests")+"</h2><p class=\\"notice\\">"+t("ui.review_outcomes_protocols_and_latency_for_recent_requests_logs")+"</p><details><summary>"+t("ui.understanding_logs")+"</summary><p class=\\"notice\\">"+t("ui.a_dash_indicates_unknown_data_ttft_is_the_time")+"</p></details><div style=\\"overflow:auto\\"><table><thead><tr><th>"+t("ui.time")+"</th><th>Protocol</th><th>Model / Provider</th><th>"+t("ui.http_outcome")+"</th><th>"+t("ui.latency_ttft")+"</th><th>Input / Cache / Output / Reasoning</th></tr></thead><tbody>")+data.requests.map(x=>'<tr><td>'+esc(x.at)+'</td><td>'+esc(x.protocol)+'</td><td>'+esc(x.model||'—')+'<div class="muted">'+esc(x.provider||'—')+' · '+esc(x.upstreamModel||'—')+'</div></td><td>'+value(x.status)+'<div class="muted">'+esc(x.outcome||'unknown')+'</div></td><td>'+value(x.durationMs)+' ms<div class="muted">'+value(x.ttftMs)+' ms</div></td><td>'+[x.inputTokens,x.cachedInputTokens,x.outputTokens,x.reasoningTokens].map(value).join(' / ')+'<div class="muted">'+esc(x.usageSource||'unknown')+'</div></td></tr>').join('')+'</tbody></table></div></section>';if(background){const button=content.querySelector('#clear-logs');if(button)button.disabled=data.requests.length===0;commitLivePage(content,'logs',guard);return;}bindCleanup('logs',data.requests.length===0)
}
async function renderProviders(){const data=await api('providers');$('content').innerHTML=("<section class=\\"panel\\"><h2>Providers</h2><p class=\\"notice\\">"+t("ui.manage_the_sources_that_process_gateway_requests_the_chatgpt")+"</p><p class=\\"notice\\">"+t("ui.to_use_an_api_provider_enter_its_endpoint_and")+"</p><details><summary>"+t("ui.authentication_and_compatibility")+"</summary><p class=\\"notice\\">"+t("ui.provider_keys_are_stored_encrypted_leave_the_key_field")+"</p></details><form id=\\"provider-form\\" class=\\"form\\"><input id=\\"provider-id\\" class=\\"input\\" placeholder=\\"Provider ID\\" required><input id=\\"provider-name\\" class=\\"input\\" placeholder=\\""+t("ui.provider_name")+"\\" required><select id=\\"provider-type\\" class=\\"input\\"><option value=\\"coworker-widget\\">ChatGPT MCP/widget</option><option value=\\"openai\\">OpenAI</option><option value=\\"anthropic\\">Anthropic</option><option value=\\"openai-compatible\\">OpenAI-compatible</option></select><input id=\\"provider-url\\" class=\\"input\\" placeholder=\\"Base URL (HTTPS)\\"><input id=\\"provider-key\\" class=\\"input\\" type=\\"password\\" autocomplete=\\"new-password\\" placeholder=\\""+t("ui.api_key_not_shown_again")+"\\"><select id=\\"provider-wire\\" class=\\"input\\"><option value=\\"responses\\">Responses</option><option value=\\"chat-completions\\">Chat Completions</option></select><label><input id=\\"provider-enabled\\" type=\\"checkbox\\" checked> "+t("ui.enabled")+"</label><button class=\\"primary\\">"+t("ui.save_provider")+"</button></form><div id=\\"provider-result\\" class=\\"notice\\"></div><div id=\\"provider-list\\"></div></section>");$('provider-list').innerHTML=data.providers.map(p=>'<div class="row"><div><strong>'+esc(p.name)+'</strong><div class="muted">'+esc(p.id)+' · '+esc(p.type)+' · '+esc(p.baseUrl||'MCP/widget')+'</div><div class="muted">'+(p.hasCredential?t("ui.api_key_stored_encrypted"):t("ui.no_api_key_stored"))+' · '+(p.enabled?t("ui.enabled_2"):t("ui.disabled"))+'</div></div><div><button class="secondary" data-edit-provider="'+esc(p.id)+("\\">"+t("ui.edit")+"</button> <button class=\\"secondary\\" data-test-provider=\\"")+esc(p.id)+("\\">"+t("ui.test_connection")+"</button></div></div>")).join('')||("<p class=\\"notice\\">"+t("ui.no_providers_added")+"</p>");$('provider-wire').disabled=$('provider-type').value==='anthropic';$('provider-type').onchange=()=>{$('provider-wire').disabled=$('provider-type').value==='anthropic'};$('provider-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;try{if(button)button.disabled=true;const type=$('provider-type').value;const payload={name:$('provider-name').value.trim(),type,enabled:$('provider-enabled').checked};if(type!=='coworker-widget'){payload.baseUrl=$('provider-url').value.trim();if(type!=='anthropic')payload.wireApi=$('provider-wire').value;if($('provider-key').value)payload.apiKey=$('provider-key').value}await api('providers/'+encodeURIComponent($('provider-id').value.trim()),{method:'PUT',body:JSON.stringify(payload)});$('provider-key').value='';await renderProviders();$('provider-result').textContent=t("ui.provider_saved_select_test_connection_to_verify_the_configuration")}catch(err){$('provider-key').value='';$('provider-result').textContent=friendlyError(err.message)}finally{if(button)button.disabled=false}};document.querySelectorAll('[data-edit-provider]').forEach(b=>b.onclick=()=>{const p=data.providers.find(x=>x.id===b.dataset.editProvider);if(!p)return;$('provider-id').value=p.id;$('provider-name').value=p.name;$('provider-type').value=p.type;$('provider-wire').disabled=p.type==='anthropic';$('provider-url').value=p.baseUrl||'';$('provider-wire').value=p.wireApi||'responses';$('provider-enabled').checked=p.enabled;$('provider-key').value=''});document.querySelectorAll('[data-test-provider]').forEach(b=>b.onclick=async()=>{b.disabled=true;$('provider-result').textContent=t("ui.checking");try{const result=await api('providers/'+encodeURIComponent(b.dataset.testProvider)+'/test',{method:'POST'});$('provider-result').textContent=t("ui.connection")+result.connection+t("ui.authentication")+result.authentication+' · '+(result.latencyMs??'—')+' ms · Models: '+result.models.join(', ')}catch(err){$('provider-result').textContent=friendlyError(err.message)}finally{b.disabled=false}})}
${DASHBOARD_CONNECTION_SCRIPT}
${DASHBOARD_TOUR_SCRIPT}
${DASHBOARD_MOTION_SCRIPT}
init();</script></body></html>`;
