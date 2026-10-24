import {applyGiveawayCopy} from '../wristband/config.js';
applyGiveawayCopy();
const start=document.querySelector('#start'),exit=document.querySelector('#exit');
const welcome=document.querySelector('#welcome'),signal=document.querySelector('#signal');
let active=false,suspended=false,wake=null,wakePending=false,ownedFullscreen=false;
const effects=document.querySelector('#effects'),reduced=matchMedia('(prefers-reduced-motion: reduce)');
let effectsEnabled=!reduced.matches;
function updateEffects(){
  document.body.classList.toggle('effects-on',active&&effectsEnabled);
  document.body.classList.toggle('effects-paused',active&&!effectsEnabled);
  effects.textContent=effectsEnabled?'Pause effects':'Enable pulse';
  effects.setAttribute('aria-pressed',String(effectsEnabled));
  document.querySelector('#motion-note').hidden=!reduced.matches;
}
effects.addEventListener('click',()=>{effectsEnabled=!effectsEnabled;updateEffects();});
reduced.addEventListener('change',()=>{effectsEnabled=!reduced.matches;updateEffects();});
updateEffects();

async function releaseWake(){const old=wake;wake=null;try{await old?.release();}catch{}}
async function acquireWake(){
  if(!active||suspended||document.visibilityState!=='visible'||wake||wakePending||!navigator.wakeLock?.request)return;
  wakePending=true;
  try{
    const lock=await navigator.wakeLock.request('screen');
    if(!active||suspended||document.visibilityState!=='visible'){await lock.release();return;}
    wake=lock;lock.addEventListener('release',()=>{if(wake===lock)wake=null;});
  }catch{/* Unsupported/denied wake lock must never block the signal. */}
  finally{wakePending=false;}
}
async function immersive(){
  // Called directly from a tap; fullscreen is progressive enhancement only.
  try{if(!document.fullscreenElement&&document.documentElement.requestFullscreen){await document.documentElement.requestFullscreen();ownedFullscreen=true;}}catch{}
  if(!active){if(ownedFullscreen){try{await document.exitFullscreen();}catch{}ownedFullscreen=false;}return;}
  try{if(document.fullscreenElement&&screen.orientation?.lock)await screen.orientation.lock('landscape');}catch{}
  if(!active){try{screen.orientation?.unlock?.();}catch{}}
}
start.addEventListener('click',()=>{
  active=true;welcome.hidden=true;signal.hidden=false;document.body.classList.add('active');
  updateEffects();
  exit.focus({preventScroll:true});void immersive();void acquireWake();
});
async function stop(){
  active=false;signal.hidden=true;welcome.hidden=false;document.body.classList.remove('active');
  updateEffects();
  void releaseWake();
  try{screen.orientation?.unlock?.();}catch{}
  if(ownedFullscreen){ownedFullscreen=false;try{await document.exitFullscreen();}catch{}}
  start.focus({preventScroll:true});
}
exit.addEventListener('click',stop);
document.addEventListener('keydown',event=>{if(active&&event.key==='Escape')void stop();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void acquireWake();else void releaseWake();});
window.addEventListener('pagehide',()=>{suspended=true;void releaseWake();});
window.addEventListener('pageshow',()=>{suspended=false;void acquireWake();});
