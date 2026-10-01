import {makePlan,gainAt} from './mix.js';
import {publishLibrary} from './publish.js';
const $=s=>document.querySelector(s), status=message=>{$('#status').textContent=message;};
const fmt=n=>{n=Math.max(0,Math.floor(n||0));return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;};
const basename=p=>{try{return decodeURIComponent(p).split(/[\\/]/).at(-1).toLowerCase();}catch{return p.split(/[\\/]/).at(-1).toLowerCase();}};
let key=null, tracks=[],plan=[], selected=0, libraryName='',libraryVersion='',context,master,playing=false,offset=0,anchor=0,timer,epoch=0,busy=false,search='',wakeLock;
const buffers=new Map(), pending=new Map(), voices=new Map();
let settings={tempo:120,bars:16,sync:true}, overrides={};
try{overrides=JSON.parse(localStorage.getItem('practice-points')||'{}');}catch{}
const dbPromise=new Promise((resolve,reject)=>{const r=indexedDB.open('pauly-practice',1);r.onupgradeneeded=()=>r.result.createObjectStore('files');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
dbPromise.catch(()=>{});
async function storage(method,id,value){const db=await dbPromise;return new Promise((resolve,reject)=>{const tx=db.transaction('files',method==='get'?'readonly':'readwrite');const store=tx.objectStore('files');const request=method==='get'?store.get(id):store.put(value,id);tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);});}
async function keep(id,value){try{await storage('put',id,value);}catch{status('Playing normally. Browser storage is full or unavailable; this file will need to download again next time.');}}
function audioContext(){if(!context){context=new AudioContext();master=context.createGain();master.gain.value=Number($('#volume').value);master.connect(context.destination);}return context;}
async function decrypt(data){if(!key)throw Error('Unlock your library first.');return crypto.subtle.decrypt({name:'AES-GCM',iv:data.slice(0,12)},key,data.slice(12));}
async function unlock(value){
  const clean=value.trim();if(!/^[A-Za-z0-9_-]{43}$/.test(clean))throw Error('Paste the complete 43-character library key.');
  const bytes=Uint8Array.from(atob(clean.replace(/-/g,'+').replace(/_/g,'/')+'='),c=>c.charCodeAt(0));
  key=await crypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,['decrypt','encrypt']);
  let data;
  try{const response=await fetch('library/library.bin',{cache:'no-cache'});if(!response.ok)throw Error('Library unavailable');data=await response.arrayBuffer();await keep('manifest',data);}catch{data=await storage('get','manifest').catch(()=>null);if(!data)throw Error('Cannot reach the library. Check your connection and try again.');}
  let manifest;try{manifest=JSON.parse(new TextDecoder().decode(await decrypt(data)));}catch{key=null;throw Error('That key did not unlock this library. Check your private access file.');}
  libraryVersion=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(b=>b.toString(16).padStart(2,'0')).join('');
  const imported=await storage('get','local-manifest').catch(()=>[])||[];
  tracks=[...manifest.tracks,...imported.filter(t=>!manifest.tracks.some(hosted=>hosted.id===t.id))];libraryName=manifest.name;settings.tempo=tracks.find(t=>t.bpm)?.bpm||120;
  $('#tempo').value=settings.tempo;$('#access-key').value='';$('#lock').hidden=false;showRoom();status(`${tracks.length} tracks unlocked. Select a track or press Play.`);
}
function showRoom(){ pause();offset=0;lastDeckIds=['',''];$('#gate').hidden=true;$('#room').hidden=false;$('#library-title').textContent=libraryName||'On this device';replan();renderQueue();select(0); }
function replan(){plan=makePlan(tracks,settings,overrides);$('#total').textContent=fmt(plan.at(-1)?.end);$('#seek').max=plan.at(-1)?.end||1;}
function currentTime(){return playing?offset+context.currentTime-anchor:offset;}
function stopNodes(){for(const v of voices.values()){try{v.source.stop();}catch{}v.source.disconnect();v.gain.disconnect();}voices.clear();}
function pause(){offset=currentTime();playing=false;epoch++;stopNodes();clearInterval(timer);$('#play').textContent='▶ Play';if(wakeLock){wakeLock.release().catch(()=>{});wakeLock=null;}if('mediaSession'in navigator)navigator.mediaSession.playbackState='paused';}
async function decode(track){
  if(buffers.has(track.id))return buffers.get(track.id);
  if(pending.has(track.id))return pending.get(track.id);
  const task=(async()=>{
    let data;
    if(track.local){const blob=await storage('get','local:'+track.id);if(!blob)throw Error('Audio missing from this browser. Import the file again.');data=await blob.arrayBuffer();}
    else{const cacheId='audio:'+libraryVersion+':'+track.file;let encrypted=await storage('get',cacheId).catch(()=>null);if(!encrypted){const r=await fetch('library/'+track.file);if(!r.ok)throw Error(`Download failed for “${track.name}”. Retry with a connection.`);encrypted=await r.arrayBuffer();await keep(cacheId,encrypted);}data=await decrypt(encrypted);}
    let buffer;try{buffer=await audioContext().decodeAudioData(data);}catch{throw Error(`This browser cannot decode “${track.name}”. Try MP3 or AAC audio.`);}
    buffers.set(track.id,buffer);return buffer;
  })();pending.set(track.id,task);try{return await task;}finally{pending.delete(track.id);}
}
function schedule(item,buffer,time){
  if(voices.has(item.index)||item.end<=time)return;
  const ctx=audioContext(),source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=buffer;source.connect(gain);gain.connect(master);
  const start=Math.max(time,item.start),when=anchor+(start-offset),sourceTime=Math.max(0,item.source(start-item.start));
  if(sourceTime>=buffer.duration)return;
  const g=item.gs.findLast(g=>g.time<=sourceTime)||item.gs[0];
  source.playbackRate.setValueAtTime(item.synced?settings.tempo/g.bpm:1,when);
  if(item.synced)for(const marker of item.gs){if(marker.time>sourceTime&&marker.time<item.outro)source.playbackRate.setValueAtTime(settings.tempo/marker.bpm,anchor+(item.start+item.local(marker.time)-offset));}
  // The fade curve sets its own initial value. A separate setValueAtTime at
  // the same instant conflicts with setValueCurveAtTime in Chromium.
  function ramp(from,to){from=Math.max(from,start);if(to<=from)return;const curve=Float32Array.from({length:128},(_,i)=>gainAt(item,from+(to-from)*i/127));gain.gain.setValueCurveAtTime(curve,anchor+from-offset,to-from);}
  ramp(item.start,item.start+item.fadeIn);ramp(item.end-item.fadeOut,item.end);
  source.start(when,sourceTime);source.stop(anchor+item.end-offset);
  voices.set(item.index,{source,gain});source.onended=()=>{if(voices.get(item.index)?.source===source){voices.delete(item.index);source.disconnect();gain.disconnect();}};
}
async function play(){
  if(!tracks.length){status('Import audio files first.');return;}
  if(busy)return;busy=true;$('#play').disabled=true;const token=++epoch;
  try{audioContext();await context.resume();if(offset>=plan.at(-1).end)offset=0;
    const active=plan.filter(p=>p.start<=offset+.01&&p.end>offset);status('Preparing audio…');
    await Promise.all(active.map(p=>decode(p.track)));if(token!==epoch)return;
    anchor=context.currentTime+.08;playing=true;
    active.forEach(p=>schedule(p,buffers.get(p.track.id),offset));
    $('#play').textContent='Ⅱ Pause';status('Playing · beat sync '+(settings.sync?'on (pitch follows tempo)':'off'));
    timer=setInterval(()=>tick().catch(fail),250);tick().catch(fail);
    if('wakeLock'in navigator)navigator.wakeLock.request('screen').then(v=>{if(playing)wakeLock=v;else v.release();}).catch(()=>{});
    if('mediaSession'in navigator)navigator.mediaSession.playbackState='playing';
  }catch(error){fail(error);}finally{busy=false;$('#play').disabled=false;}
}
function fail(error){pause();status(error.message||String(error));}
let ticking=false;
async function tick(){
  if(!playing||ticking)return;ticking=true;const token=epoch;
  try{const time=currentTime();if(time>=plan.at(-1).end){pause();offset=plan.at(-1).end;status('Session complete.');return;}
    const current=plan.findLast(p=>p.start<=time)||plan[0];
    const active=plan.filter(p=>p.start<=time&&p.end>time);
    // Keep only two decoded decks in memory, including during an overlap.
    const needed=active.length>1?active:plan.filter(p=>p.end>time&&p.index<=current.index+1);
    for(const item of needed){if(voices.has(item.index))continue;const buffer=await decode(item.track);if(token!==epoch)return;
      const now=currentTime();if(item.start<now&&item.index>current.index){status('Connection was slow; joining the next track in time.');}
      schedule(item,buffer,now);
    }
    const allowed=new Set(needed.map(p=>p.track.id));for(const id of buffers.keys())if(!allowed.has(id))buffers.delete(id);
  }finally{ticking=false;}
}
async function go(time,autoplay=playing){pause();offset=Math.max(0,Math.min(plan.at(-1)?.end||0,time));if(autoplay)await play();}
function activeIndex(){return (plan.findLast(p=>p.start<=currentTime())||plan[0])?.index||0;}
function select(index){selected=Math.max(0,Math.min(tracks.length-1,index));const item=plan[selected];if(!item)return;
  $('#edit-title').textContent=item.track.name;$('#intro').value=item.intro.toFixed(2);$('#outro').value=item.outro.toFixed(2);
  $('#in-cue').replaceChildren(new Option('Choose a cue…',''));
  for(const cue of item.track.cues||[])$('#in-cue').add(new Option(`${cue.number<0?'M':cue.number+1} · ${cue.name} · ${fmt(cue.time)}`,cue.time));
  const variable=new Set(item.gs.map(g=>Math.round(g.bpm*10))).size>1;
  $('#track-note').textContent=`${item.track.metadata||'Imported'} · ${item.track.bpm?item.track.bpm+' BPM':'BPM unknown: natural-speed crossfade'} · ${item.track.key||'Key unknown'}${variable?' · Variable beat grid: tempo changes are followed.':''} · Transition points are saved on this device.`;
  renderQueue();
}
function renderQueue(){
  $('#count').textContent=`${tracks.length} tracks`;const list=$('#tracks');list.replaceChildren();
  tracks.forEach((t,i)=>{if(search&&!`${t.name} ${t.artist}`.toLowerCase().includes(search))return;
    const row=document.createElement('li');row.className='track'+(i===selected?' selected':'');row.tabIndex=0;
    const num=document.createElement('span');num.className='num';num.textContent=String(i+1).padStart(2,'0');
    const copy=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('small');title.textContent=t.name;detail.textContent=`${t.artist||'—'} · ${t.bpm||'?'} BPM · ${t.key||'?'} · ${fmt(t.duration)}`;copy.append(title,detail);
    const button=document.createElement('button');button.textContent='▶';button.setAttribute('aria-label','Play '+t.name);button.onclick=e=>{e.stopPropagation();select(i);go(plan[i].start,true).catch(fail);};
    row.append(num,copy,button);row.onclick=()=>select(i);row.onkeydown=e=>{if(e.target===row&&(e.key==='Enter'||e.key===' ')){e.preventDefault();select(i);}};list.append(row);
  });
}
let lastDeckIds=['',''];
function drawDeck(side,item,time){
  const root=$(side===0?'#deck-a':'#deck-b');if(!item)return;const t=item.track,live=time>=item.start&&time<item.end,position=live?item.source(time-item.start):item.intro;
  if(lastDeckIds[side]!==t.id){lastDeckIds[side]=t.id;root.querySelector('h2').textContent=t.name;root.querySelector('.artist').textContent=t.artist||' ';root.querySelector('.key').textContent=(t.key||'?')+' KEY';
    const cues=root.querySelector('.cues');cues.replaceChildren();for(const cue of t.cues||[]){const b=document.createElement('button');b.textContent=cue.number<0?'M':String(cue.number+1);b.title=cue.name+' · '+fmt(cue.time);b.onclick=()=>{select(item.index);go(item.start+Math.max(0,item.local(cue.time)),true).catch(fail);};cues.append(b);}
    root.querySelector('canvas').onclick=e=>{const r=e.currentTarget.getBoundingClientRect(),seconds=(e.clientX-r.left)/r.width*t.duration;select(item.index);go(item.start+Math.max(0,Math.min(item.duration,item.local(seconds))),playing).catch(fail);};
  }
  const marker=item.gs.findLast(g=>g.time<=position)||item.gs[0],rate=item.synced?settings.tempo/marker.bpm:1;
  root.querySelector('.bpm').textContent=(item.synced?settings.tempo:t.bpm||'?')+' BPM';root.querySelector('.pitch').textContent=`${((rate-1)*100).toFixed(1)}% speed`;
  root.querySelector('.deck-state').textContent=live?(playing?'PLAYING':'PAUSED'):'NEXT';root.querySelector('.position').textContent=fmt(position);root.querySelector('.remaining').textContent='−'+fmt(t.duration-position);
  const canvas=root.querySelector('canvas'),w=Math.round(canvas.clientWidth*devicePixelRatio),h=Math.round(canvas.clientHeight*devicePixelRatio);if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;const c=canvas.getContext('2d');c.clearRect(0,0,w,h);const peaks=t.peaks||[];
  for(let x=0;x<w;x+=3*devicePixelRatio){const p=peaks[Math.floor(x/w*peaks.length)]||.03;const height=Math.max(2,p*h*.85);c.fillStyle=x/w<position/t.duration?(side?'#51e3d1':'#4389ff'):'#34435c';c.fillRect(x,(h-height)/2,2*devicePixelRatio,height);}
  c.fillStyle='#fff';c.fillRect(position/t.duration*w,0,devicePixelRatio,h);
  for(const cue of t.cues||[]){c.fillStyle='#ffb75e';c.fillRect(cue.time/t.duration*w,0,devicePixelRatio,10*devicePixelRatio);}
}
function frame(){if(plan.length){const time=currentTime(),i=activeIndex(),active=plan.filter(p=>p.start<=time&&p.end>time);let pair=active.length===2?active:[plan[i],plan[i+1]||plan[i-1]];if(!playing&&time===0)pair=[plan[selected],plan[selected+1]||plan[selected-1]];
  for(let side=0;side<2;side++){const item=pair.find(p=>p&&p.index%2===side);if(item)drawDeck(side,item,time);else{const root=$(side===0?'#deck-a':'#deck-b');lastDeckIds[side]='';root.querySelector('h2').textContent='—';root.querySelector('.artist').textContent='No next track';root.querySelector('.deck-state').textContent='READY';root.querySelector('.cues').replaceChildren();root.querySelector('canvas').getContext('2d').clearRect(0,0,root.querySelector('canvas').width,root.querySelector('canvas').height);for(const s of ['.bpm','.key','.pitch','.position','.remaining'])root.querySelector(s).textContent='—';}}
  $('#elapsed').textContent=fmt(time);if(document.activeElement!==$('#seek'))$('#seek').value=time;
  const incoming=active.length===2?active[1]:null;
  $('#mix-progress').value=incoming?(incoming.index%2?gainAt(incoming,time):1-gainAt(incoming,time)):(i%2);
  $('#mix-label').textContent=incoming?'Mixing · '+fmt(incoming.start+incoming.fadeIn-time)+' left':'Next mix '+(plan[i+1]?fmt(Math.max(0,plan[i+1].start-time)):'—');
 }requestAnimationFrame(frame);}requestAnimationFrame(frame);
$('#unlock-form').onsubmit=async e=>{e.preventDefault();const b=e.currentTarget.querySelector('button');b.disabled=true;status('Unlocking…');try{await unlock($('#access-key').value);}catch(e){status(e.message);}finally{b.disabled=false;}};
$('#lock').onclick=()=>{pause();key=null;tracks=[];plan=[];buffers.clear();$('#room').hidden=true;$('#gate').hidden=false;$('#lock').hidden=true;status('Library locked.');};
$('#local-start').onclick=async()=>{tracks=await storage('get','local-manifest').catch(()=>[])||[];libraryName='On this device';showRoom();$('#imports').hidden=false;};
$('#import-toggle').onclick=()=>$('#imports').hidden=!$('#imports').hidden;
$('#publish-library').onclick=async()=>{const button=$('#publish-library');button.disabled=true;try{await publishLibrary({token:$('#publish-token').value,key,tracks,name:libraryName,libraryVersion,readFile:id=>storage('get','local:'+id),status});status('Encrypted additions published. Wait for deployment, then unlock the library on your other device.');}catch(e){status(e.message);}finally{$('#publish-token').value='';button.disabled=false;}};
$('#save-offline').onclick=async()=>{const button=$('#save-offline');button.disabled=true;try{const hosted=tracks.filter(t=>!t.local);if(!hosted.length)throw Error('Imported tracks are already saved on this device.');if(navigator.storage?.persist)await navigator.storage.persist();for(let i=0;i<hosted.length;i++){status(`Saving encrypted audio ${i+1}/${hosted.length} for this device…`);const t=hosted[i],id='audio:'+libraryVersion+':'+t.file;if(!await storage('get',id)){const r=await fetch('library/'+t.file);if(!r.ok)throw Error('Download failed. Retry to continue saving.');await storage('put',id,await r.arrayBuffer());}}status('Library saved on this device. Keep your access key for unlocking offline.');}catch(e){status(e.message+' Browser storage may be limited; already saved tracks are retained.');}finally{button.disabled=false;}};
$('#play').onclick=()=>playing?pause():play();
$('#prev').onclick=()=>{const i=Math.max(0,activeIndex()-1);select(i);go(plan[i].start,true).catch(fail);};
$('#next').onclick=()=>{const i=Math.min(plan.length-1,activeIndex()+1);select(i);go(plan[i].start,true).catch(fail);};
$('#preview').onclick=()=>{const next=plan[selected+1];if(!next){status('Select a track with another track after it.');return;}go(Math.max(plan[selected].start,next.start-8*60/settings.tempo),true).catch(fail);};
$('#seek').onchange=e=>go(Number(e.target.value)).catch(fail);
$('#volume').oninput=e=>{if(master)master.gain.setTargetAtTime(Number(e.target.value),context.currentTime,.02);};
function changeSettings(){const bpm=Number($('#tempo').value);if(bpm<60||bpm>180||!Number.isFinite(bpm)){status('Choose a tempo from 60 to 180 BPM.');return;}const was=playing;const index=activeIndex();pause();settings={tempo:bpm,bars:Number($('#bars').value),sync:$('#sync').checked};replan();select(selected);offset=plan[index]?.start||0;if(was)play();}
for(const selector of ['#tempo','#bars','#sync'])$(selector).onchange=changeSettings;
$('#in-cue').onchange=e=>{if(e.target.value!=='')$('#intro').value=e.target.value;};
$('#save-points').onclick=()=>{const t=tracks[selected];if(!t)return;const intro=Number($('#intro').value),outro=Number($('#outro').value);if(!(intro>=0&&outro<=t.duration&&outro>intro+1)){status('Intro must be before the outro, within the track duration.');return;}pause();overrides[t.id]={intro,outro};try{localStorage.setItem('practice-points',JSON.stringify(overrides));}catch{}replan();offset=plan[selected].start;select(selected);status('Transition points saved. Use Preview transition to listen.');};
$('#reset-points').onclick=()=>{if(!tracks[selected])return;pause();delete overrides[tracks[selected].id];try{localStorage.setItem('practice-points',JSON.stringify(overrides));}catch{}replan();offset=plan[selected].start;select(selected);};
$('#search').oninput=e=>{search=e.target.value.toLowerCase();renderQueue();};
async function saveLocal(){await keep('local-manifest',tracks.filter(t=>t.local));}
$('#audio-files').onchange=async e=>{pause();const files=[...e.target.files];try{audioContext();for(let i=0;i<files.length;i++){const f=files[i];status(`Importing ${i+1}/${files.length}: ${f.name}`);const buffer=await context.decodeAudioData(await f.arrayBuffer());const samples=buffer.getChannelData(0),stride=Math.max(1,Math.floor(samples.length/900)),peaks=[];for(let j=0;j<samples.length;j+=stride){let max=0;for(let k=j;k<Math.min(j+stride,samples.length);k+=8)max=Math.max(max,Math.abs(samples[k]));peaks.push(max);}const id='local-'+crypto.randomUUID();await storage('put','local:'+id,f);tracks.push({id,name:f.name,filename:f.name,artist:'',duration:buffer.duration,bpm:0,key:'',intro:0,grids:[],cues:[],peaks,local:true,metadata:'Imported'});}await saveLocal();replan();select(tracks.length-files.length);status(`${files.length} audio files saved on this device.`);}catch(error){status('Import stopped: '+error.message+' Already imported tracks are retained.');replan();renderQueue();await saveLocal();}};
$('#xml-file').onchange=async e=>{try{pause();const file=e.target.files[0];if(!file)return;const doc=new DOMParser().parseFromString(await file.text(),'application/xml');if(doc.querySelector('parsererror'))throw Error('Invalid XML');const index=new Map();for(const t of doc.querySelectorAll('COLLECTION > TRACK')){const n=basename(t.getAttribute('Location')||'');if(index.has(n))index.set(n,null);else index.set(n,t);}let matched=0;for(const t of tracks.filter(t=>t.local)){const x=index.get(basename(t.filename));if(!x)continue;matched++;t.name=x.getAttribute('Name')||t.name;t.artist=x.getAttribute('Artist')||'';t.key=x.getAttribute('Tonality')||'';t.bpm=Number(x.getAttribute('AverageBpm'));t.grids=[...x.querySelectorAll('TEMPO')].map(g=>({time:Number(g.getAttribute('Inizio')),bpm:Number(g.getAttribute('Bpm')),beat:Number(g.getAttribute('Battito'))}));t.cues=[...x.querySelectorAll('POSITION_MARK')].map(c=>({time:Number(c.getAttribute('Start')),name:c.getAttribute('Name')||'Cue',number:Number(c.getAttribute('Num'))}));const g=t.grids[0];t.intro=g&&g.bpm>0?g.time+((1-g.beat+4)%4)*60/g.bpm:0;t.metadata='Rekordbox';}await saveLocal();replan();select(selected);status(`Matched ${matched} imported tracks to Rekordbox. Unmatched files keep their original metadata.`);}catch(e){status(e.message);}};
$('#playlist-file').onchange=async e=>{try{pause();const f=e.target.files[0];if(!f)return;const names=(await f.text()).replace(/^\uFEFF/,'').split(/\r?\n/).filter(s=>s.trim()&&!s.startsWith('#')).map(basename);const ordered=[],used=new Set();for(const name of names){const t=tracks.find(t=>basename(t.filename||'')===name&&!used.has(t.id));if(t){ordered.push(t);used.add(t.id);}}if(!ordered.length)throw Error('No imported filenames matched. Import the playlist audio files first.');tracks=[...ordered,...tracks.filter(t=>!used.has(t.id))];libraryName=f.name.replace(/\.m3u8?$/i,'');$('#library-title').textContent=libraryName;await saveLocal();replan();select(0);offset=0;status(`Ordered ${ordered.length}/${names.length} playlist entries. Unmatched tracks remain at the end.`);}catch(e){status(e.message);}};
if('mediaSession'in navigator){navigator.mediaSession.setActionHandler('play',()=>play());navigator.mediaSession.setActionHandler('pause',pause);navigator.mediaSession.setActionHandler('nexttrack',()=>$('#next').click());navigator.mediaSession.setActionHandler('previoustrack',()=>$('#prev').click());}
const fragment=new URLSearchParams(location.hash.slice(1)),linkKey=fragment.get('key');
if(linkKey){history.replaceState(null,'',location.pathname);unlock(linkKey).catch(e=>status(e.message));}
if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
