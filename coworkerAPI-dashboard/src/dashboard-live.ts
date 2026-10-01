// SSE invalidation with bounded polling fallback. Never replaces setup forms.
export const DASHBOARD_LIVE_SCRIPT = `
let dashboardEvents=null,liveConnected=false,liveBusy=false,liveRevision=null;
function stopDashboardLive(){dashboardEvents?.close();dashboardEvents=null;liveConnected=false}
function updateOverviewMetrics(o){if(page!=='overview')return;const nodes=document.querySelectorAll('#content .metrics .metric strong');[o.requestsToday,o.activeKeys,o.errorsToday,o.averageLatencyMs].forEach((value,i)=>{const el=nodes[i];if(!el)return;const text=String(value??0);if(i===3){if(el.firstChild?.nodeType===3)el.firstChild.textContent=text}else if(el.textContent!==text)el.textContent=text})}
function commitLivePage(next,kind,guard){
  if(!guard())return;
  const content=$('content');let slot=$('dashboard-live-data');
  if(!slot){slot=document.createElement('div');slot.id='dashboard-live-data';for(const child of [...content.children])if(!child.classList.contains('page-actions'))slot.append(child);content.append(slot)}
  if(!next)return;
  const html=[...next.children].filter(el=>!el.classList.contains('page-actions')).map(el=>el.outerHTML).join('');
  if(slot.innerHTML===html)return;
  const details=[...slot.querySelectorAll('details')].map(el=>el.open);
  const scroll=[...slot.querySelectorAll('div[style*="overflow"]')].map(el=>({top:el.scrollTop,left:el.scrollLeft}));
  slot.innerHTML=html;
  slot.querySelectorAll('details').forEach((el,i)=>el.open=details[i]??false);
  slot.querySelectorAll('div[style*="overflow"]').forEach((el,i)=>{if(scroll[i]){el.scrollTop=scroll[i].top;el.scrollLeft=scroll[i].left}});
  const button=$('clear-'+kind);if(button&&!button.dataset.busy)button.disabled=next.querySelector('#clear-'+kind)?.disabled??false;
}
async function applyDashboardLive(event){
  if(!csrf||document.hidden)return;
  updateBridge(event.overview);updateConnectionStatus(event.overview);updateOverviewMetrics(event.overview);dashboardTour.refreshCheck?.();
  if(liveBusy||localeSwitching||$('confirm-dialog')?.open||dashboardTour.isActive?.())return;
  if(event.revision!==undefined&&event.revision===liveRevision)return;
  const selected=page,generation=renderGeneration;
  const guard=()=>csrf&&page===selected&&renderGeneration===generation&&!localeSwitching;
  liveBusy=true;
  try{
    if(selected==='usage')await renderUsage(true,guard);
    if(selected==='logs')await renderLogs(true,guard);
    if(guard())liveRevision=event.revision;
  }catch{}finally{liveBusy=false}
}
function startDashboardLive(){
  stopDashboardLive();liveRevision=null;
  if(!csrf||document.hidden||typeof EventSource==='undefined')return;
  dashboardEvents=new EventSource('/api/admin/v1/events');
  dashboardEvents.onopen=()=>{liveConnected=true};
  dashboardEvents.onerror=()=>{liveConnected=false};
  dashboardEvents.addEventListener('update',event=>{try{void applyDashboardLive(JSON.parse(event.data))}catch{}});
}
setInterval(async()=>{if(!csrf){stopDashboardLive();return}if(document.hidden||liveConnected||liveBusy)return;try{await applyDashboardLive({overview:await api('overview')})}catch{}},3000);
if(typeof document.addEventListener==='function')document.addEventListener('visibilitychange',()=>{if(document.hidden)stopDashboardLive();else{startDashboardLive();if(csrf)api('overview').then(overview=>applyDashboardLive({overview})).catch(()=>{})}});
if(typeof window!=='undefined'&&typeof window.addEventListener==='function')window.addEventListener('pagehide',stopDashboardLive);
`;
