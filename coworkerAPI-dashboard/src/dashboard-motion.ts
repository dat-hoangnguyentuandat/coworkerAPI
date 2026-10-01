// Circular theme reveal adapted from coworker-web/assets/js/site.js.
// Motion is optional: settings remain usable without View Transitions or WAAPI.
export const DASHBOARD_MOTION_SCRIPT = `
const reducedDashboardMotion=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
async function toggleDashboardTheme(event={}){
  const button=$('theme-toggle');if(!button||button.disabled)return;
  button.disabled=true;
  const root=document.documentElement;
  const next=root.dataset.theme==='light'?'dark':'light';
  const update=()=>{root.dataset.theme=next;try{localStorage.setItem('coworkerapi-theme',next)}catch{}};
  try{
    if(reducedDashboardMotion()||typeof document.startViewTransition!=='function'||typeof root.animate!=='function'){update();return}
    const rect=button.getBoundingClientRect();
    const pointer=event.detail!==0&&Number.isFinite(event.clientX)&&Number.isFinite(event.clientY);
    const x=pointer?event.clientX:rect.left+rect.width/2;
    const y=pointer?event.clientY:rect.top+rect.height/2;
    const radius=Math.hypot(Math.max(x,innerWidth-x),Math.max(y,innerHeight-y));
    const transition=document.startViewTransition(update);
    await transition.ready;
    const animation=root.animate({clipPath:['circle(0px at '+x+'px '+y+'px)','circle('+radius+'px at '+x+'px '+y+'px)']},{duration:520,easing:'cubic-bezier(.2,.8,.2,1)',pseudoElement:'::view-transition-new(root)'});
    await animation.finished;
    await transition.finished;
  }catch{update()}finally{button.disabled=false}
}
async function refreshDashboard(){
  const button=$('refresh-page'),content=$('content');if(!button||button.disabled)return;
  button.disabled=true;button.classList.add('is-refreshing');button.setAttribute('aria-busy','true');content.setAttribute('aria-busy','true');
  const started=Date.now();
  try{
    await render();
    if(!reducedDashboardMotion()){
      const remaining=350-(Date.now()-started);
      if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));
      if(typeof content.animate==='function')content.animate([{opacity:.65,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],{duration:240,easing:'cubic-bezier(.2,.8,.2,1)'}).finished.catch(()=>{});
    }
  }finally{button.disabled=false;button.classList.remove('is-refreshing');button.removeAttribute('aria-busy');content.removeAttribute('aria-busy')}
}
if($('theme-toggle'))$('theme-toggle').onclick=toggleDashboardTheme;
if($('refresh-page'))$('refresh-page').onclick=refreshDashboard;
`;
