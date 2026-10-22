import {StreamMixer,gainAt} from './mixer.js?v=20261022-discovery';
import {PreviewPlayer} from './preview.js?v=20261022-discovery';
import {favoriteOrder} from './order.js';
import {audioKey,eligible,shuffled,candidates,mixScore,uniqueTracks} from './discovery.js?v=20261022';
const $=s=>document.querySelector(s),status=t=>{$('#status').textContent=t;};
const fmt=n=>{n=Math.max(0,Math.floor(n||0));return Math.floor(n/60)+':'+String(n%60).padStart(2,'0');};
let server='',catalog={tracks:[],playlists:[]},visible=[],favoriteOnly=false,query='',connected=false,lastIndex=-1,lastMetadata='',connecting=false,rowLimit=200;
let favorites=new Set(),favoriteWrites=Promise.resolve(),syncingFavorites=false;
const pendingFavorites=new Set();
const requests=new Set();
let heard=new Set(),favoriteAudio=new Set(),byTrack=new Map(),lastAudible=null,pairPrevious=null,lastPair=null,savedPairs=[],recommendVersion=0,savingPair=false,pairAudition=false;
const controls=document.createElement('section');controls.className='panel discovery-controls';
controls.innerHTML='<label>Queue order<select id="queue-order"><option value="regular">Playlist order</option><option value="shuffle">Shuffle</option><option value="harmonic">Mixed in Key–style · harmonic picks</option></select></label><label class="check"><input id="skip-favorites" type="checkbox"> Skip global Favorites</label><p id="sample-count" class="note"></p><button id="reset-samples">Reset session history</button><p id="recommendation-note" class="note">No repeats in this browser tab, including after a refresh. Scrubbing and resuming the current track remain available.</p><button id="save-transition" disabled>Good transition · save both songs</button><p id="transition-context" class="note">Play two tracks to save a pairing.</p>';
document.querySelector('.toolbar').after(controls);
const pairPanel=document.createElement('section');pairPanel.className='panel';pairPanel.innerHTML='<h2>Good transitions</h2><p class="note">Saved on your PC as ordered pairs. Session repeat prevention still applies; reset session history to audition pairs you already sampled.</p><ol id="transition-pairs"></ol>';
document.querySelector('.queue').before(pairPanel);
document.querySelector('.transport').after($('#save-transition'),$('#transition-context'));
function saveHeard(){try{sessionStorage.setItem('pauly-stream-heard:v1',JSON.stringify([...heard]));}catch{}$('#sample-count').textContent=heard.size+' tracks sampled this browser session';}
function favoriteKeys(){favoriteAudio=new Set(catalog.tracks.filter(t=>favorites.has(t.id)).map(audioKey));}
function canPlay(track){return !heard.has(audioKey(track))&&(!$('#skip-favorites').checked||!favoriteAudio.has(audioKey(track)));}
function recordHeard(track){
  const original=byTrack.get(track.id)||track;
  if(pairPrevious&&pairPrevious.id!==original.id)lastPair={from:pairPrevious.id,to:original.id};
  const changed=lastAudible?.id!==original.id;pairPrevious=original;lastAudible=original;
  heard.add(audioKey(original));saveHeard();if(changed){renderRows();if($('#queue-order').value==='harmonic'&&!pairAudition)recommendNext(original);}
  update();
}
function remaining(){return eligible(playlistTracks(),{heard,favorites:favoriteAudio,avoidFavorites:$('#skip-favorites').checked});}
function ordered(tracks,reference=lastAudible){const order=$('#queue-order').value;if(order==='shuffle')return shuffled(tracks);if(order==='harmonic'&&tracks.length){const first=reference||tracks[0];return reference?candidates(first,tracks,tracks.length).map(r=>r.track):[first,...candidates(first,tracks.slice(1),tracks.length).map(r=>r.track)];}return tracks;}
async function energyFor(track){if(!track||Number.isFinite(track.energy))return;try{const data=await request('/energy/'+encodeURIComponent(track.id));if(Number.isFinite(data.energy))track.energy=data.energy;}catch{}}
async function recommendNext(reference){
  const token=++recommendVersion,engine=mixer;const pool=remaining().filter(t=>t.id!==reference.id),shortlist=candidates(reference,pool,8).map(r=>r.track);
  $('#recommendation-note').textContent='Checking likely next tracks for harmonic, BPM and energy compatibility…';
  await energyFor(reference);
  for(let i=0;i<shortlist.length;i+=2){if(token!==recommendVersion||engine!==mixer)return;await Promise.all(shortlist.slice(i,i+2).map(energyFor));}
  if(token!==recommendVersion||engine!==mixer||lastAudible?.id!==reference.id)return;
  const next=candidates(reference,remaining().filter(t=>t.id!==reference.id),catalog.tracks.length);
  engine.replaceUpcoming(next.map(r=>r.track));renderRows();
  const best=next[0];$('#recommendation-note').textContent=best?`${best.key} · ${best.delta===null?'BPM unknown':'BPM difference '+best.delta.toFixed(1)} · ${best.energyKnown?'audio-energy proxy compared':'energy unavailable'}. Heuristic suggestions, not the proprietary Mixed in Key algorithm.`:'No unheard eligible next tracks remain.';
}
function reorderUpcoming(){recommendVersion++;pairAudition=false;try{sessionStorage.setItem('pauly-stream-discovery:'+server,JSON.stringify({order:$('#queue-order').value,skip:$('#skip-favorites').checked}));}catch{}if(lastAudible&&mixer.plan[mixer.index()]?.track.id===lastAudible.id){mixer.replaceUpcoming(ordered(remaining()));renderRows();if($('#queue-order').value==='harmonic')recommendNext(lastAudible);status('Upcoming queue updated; the current track keeps playing.');}else applyPlaylist();}
$('#queue-order').onchange=reorderUpcoming;$('#skip-favorites').onchange=reorderUpcoming;
$('#reset-samples').onclick=()=>{heard.clear();lastAudible=null;pairPrevious=null;lastPair=null;saveHeard();applyPlaylist();status('Session sampling history reset. Global Favorites and saved transitions are unchanged.');};
async function loadTransitions(){const data=await request('/transitions');savedPairs=Array.isArray(data.pairs)?data.pairs:[];renderPairs();}
function renderPairs(){
  pairPanel.hidden=$('#playlist').value!=='transitions'||favoriteOnly;
  const list=$('#transition-pairs');list.replaceChildren();
  for(const pair of savedPairs){const a=byTrack.get(pair.from),b=byTrack.get(pair.to);if(!a||!b)continue;const row=document.createElement('li'),text=document.createElement('span'),button=document.createElement('button');text.textContent=a.name+' → '+b.name;button.textContent='Play pair';button.disabled=!canPlay(a)||!canPlay(b)||!a.available||!b.available;button.onclick=()=>{recommendVersion++;pairAudition=true;pairPrevious=null;lastPair=null;mixer.setQueue([a,b],Number($('#tempo').value));lastIndex=-1;renderRows();mixer.play();};row.append(text,button);list.append(row);}
  if(!list.children.length){const row=document.createElement('li');row.textContent='No saved transitions yet.';list.append(row);}
}
$('#save-transition').onclick=async()=>{if(!lastPair||savingPair)return;const pair={...lastPair};savingPair=true;update();try{const data=await request('/transitions','json',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pair)});savedPairs=data.pairs;renderPairs();status('Saved both tracks as an ordered Good transition pair on the PC.');}catch(e){status('Could not save this transition: '+e.message);}finally{savingPair=false;update();}};
const filters=document.createElement('div');filters.className='toolbar';filters.hidden=true;
filters.innerHTML='<label>Favorites order<select id="favorite-sort"><option value="bpm-asc">BPM: slowest first</option><option value="bpm-desc">BPM: fastest first</option><option value="key-asc">Key: Camelot ascending</option><option value="key-desc">Key: Camelot descending</option></select></label><label>Min BPM<input id="bpm-min" type="number" min="1" max="300" placeholder="Any"></label><label>Max BPM<input id="bpm-max" type="number" min="1" max="300" placeholder="Any"></label><label>Key<select id="key-filter"><option value="">All keys</option><option value="unknown">Unknown key</option></select></label>';
document.querySelector('.toolbar').after(filters);
for(let n=1;n<=12;n++)for(const letter of ['A','B'])$('#key-filter').add(new Option(n+letter,n+letter));
for(const input of filters.querySelectorAll('input,select'))input.onchange=()=>applyPlaylist();
const modeLabel=document.createElement('label');modeLabel.textContent='Playback mode';
const mode=document.createElement('select');mode.id='playback-mode';mode.add(new Option('Fast preview · original speed','preview'));mode.add(new Option('Automix · matched tempo','mix'));modeLabel.append(mode);document.querySelector('.settings').prepend(modeLabel);
async function request(path,kind='json',options={}){
  if(!connected&&path!='/library')throw Error('Connect to your PC first.');
  const controller=new AbortController();requests.add(controller);const timer=setTimeout(()=>controller.abort(),180000);
  try{const response=await fetch(server+path,{...options,signal:controller.signal,cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
    if(response.status===404)throw Error(path.startsWith('/favorites')?'Favorites are unavailable. Refresh the page or restart the updated PC server.':'This audio file is missing from the PC. Reconnect its drive or relocate it in Rekordbox.');
    if(!response.ok)throw Error('PC server could not serve this request ('+response.status+').');return kind==='audio'?await response.arrayBuffer():await response.json();
  }catch(e){if(e instanceof TypeError)throw Error('Cannot reach your PC. Check that the server and secure connection are running and that the PC is awake.');if(e.name==='AbortError')throw Error('Connection cancelled or timed out. Try again.');throw e;}
  finally{clearTimeout(timer);requests.delete(controller);}
}
const automixer=new StreamMixer({url:track=>server+'/audio/'+encodeURIComponent(track.id)+'?tempo='+automixer.tempo,prepareTrack:(track,tempo)=>request('/prepare/'+encodeURIComponent(track.id)+'?tempo='+tempo),onstarted:recordHeard,canPlay,onchange:()=>update(),onerror:e=>status(e.message)});
const preview=new PreviewPlayer({url:track=>server+'/audio/'+encodeURIComponent(track.id),cue:track=>request('/preview/'+encodeURIComponent(track.id)),onstarted:recordHeard,canPlay,onchange:()=>update(),onerror:e=>status(e.message)});
let mixer=preview;
function selectTrack(index,autoplay=true){const item=mixer.plan[index];if(!item)return;if(!canPlay(item.track)){if(item.track.id===lastAudible?.id&&index===mixer.index())return mixer.play();status('Already sampled this session or excluded as a Favorite. Reset history to sample it again.');return;}if(mixer===preview)return preview.open(index,autoplay);return mixer.seek(item.start,autoplay);}
mode.onchange=()=>{const old=mixer.plan[mixer.index()],id=old?.track.id,playing=mixer.playing,volume=mixer.volume,fraction=old?Math.max(0,(mixer.time()-old.start)/old.duration):0,current=byTrack.get(id);mixer.clear();mixer=mode.value==='preview'?preview:automixer;mixer.setVolume(volume);applyPlaylist();if(current&&lastAudible?.id===id&&playlistTracks().some(t=>t.id===id)){mixer.setQueue([current,...ordered(remaining())],Number($('#tempo').value));if(mixer===automixer)mixer.resumeId=id;mixer.seek(mixer.plan[0].start+Math.min(.999,fraction)*mixer.plan[0].duration,playing);}update();};
async function loadFavorites(migrate=false){
  if(syncingFavorites||pendingFavorites.size||!connected)return;syncingFavorites=true;
  try{
    let legacy=[];if(migrate)try{const saved=JSON.parse(localStorage.getItem('pauly-stream-favorites')||'[]');if(Array.isArray(saved))legacy=saved.filter(id=>typeof id==='string');}catch{}
    const data=legacy.length?await request('/favorites/import','json',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:legacy})}):await request('/favorites');
    if(!Array.isArray(data.ids))throw Error('The server did not return a favorites list.');
    const changed=[...favorites].sort().join(',')!==[...data.ids].sort().join(',');favorites=new Set(data.ids);favoriteKeys();if(migrate)try{localStorage.removeItem('pauly-stream-favorites');}catch{}
    if(!$('#room').hidden){if(changed&&$('#skip-favorites').checked)reorderUpcoming();else renderRows();update();}
  }finally{syncingFavorites=false;}
}
function toggleFavorite(id){
  if(!id||pendingFavorites.has(id))return;const favorite=!favorites.has(id);pendingFavorites.add(id);renderRows();update();
  favoriteWrites=favoriteWrites.then(async()=>{
    try{const data=await request('/favorites/'+encodeURIComponent(id),'json',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({favorite})});favorites=new Set(data.ids);status(favorite?'Added to global favorites.':'Removed from global favorites.');}
    catch(e){status('Could not save global favorites: '+e.message);}
    finally{pendingFavorites.delete(id);favoriteKeys();if(connected){if($('#skip-favorites').checked)reorderUpcoming();else renderRows();update();}}
  });
}
function playlistTracks(){if(favoriteOnly)return favoriteOrder(catalog.tracks.filter(t=>favorites.has(t.id)),{sort:$('#favorite-sort').value,min:$('#bpm-min').value,max:$('#bpm-max').value,key:$('#key-filter').value});const chosen=$('#playlist').value;const ids=chosen==='transitions'?savedPairs.flatMap(p=>[p.from,p.to]):chosen==='all'?catalog.tracks.map(t=>t.id):catalog.playlists.find(p=>p.id===chosen)?.tracks||[];return uniqueTracks(ids.map(id=>byTrack.get(id)).filter(Boolean));}
function applyPlaylist(){recommendVersion++;pairAudition=false;pairPrevious=null;lastPair=null;rowLimit=200;mixer.setQueue(ordered(remaining()),Number($('#tempo').value));lastIndex=-1;renderRows();saveHeard();status(mixer.plan.length+' unheard eligible tracks queued. No repeats across playlists in this browser session.');}
function renderRows(){
  const base=playlistTracks(),ids=new Set(base.map(t=>t.id)),queued=mixer.plan.map(p=>byTrack.get(p.track.id)||p.track).filter(t=>ids.has(t.id)),inQueue=new Set(queued.map(t=>t.id));visible=[...queued,...base.filter(t=>!inQueue.has(t.id))].filter(t=>!query||(t.name+' '+t.artist).toLowerCase().includes(query));const rows=$('#tracks');rows.replaceChildren();
  $('#queue-title').textContent=favoriteOnly?'Global favorites':$('#playlist').selectedOptions[0]?.textContent||'Collection';
  $('#count').textContent=visible.length+' tracks';$('#favorite-count').textContent=favorites.size;
  const current=mixer.plan[mixer.index()]?.track.id;
  $('#load-more').hidden=visible.length<=rowLimit;
  for(const [i,t]of visible.slice(0,rowLimit).entries()){
    const row=document.createElement('li');row.className='track'+(t.id===current?' active':'')+(!t.available?' missing':'');row.dataset.id=t.id;
    const number=document.createElement('span');number.className='number';number.textContent=String(i+1).padStart(2,'0');
    const copy=document.createElement('div'),name=document.createElement('strong'),detail=document.createElement('small');name.textContent=t.name;detail.textContent=`${t.artist||'Unknown artist'} · ${t.bpm||'?'} BPM · ${t.key||'Key unknown'} · ${fmt(t.duration)}${heard.has(audioKey(t))?' · Sampled this session':''}${$('#skip-favorites').checked&&favoriteAudio.has(audioKey(t))?' · Skipping Favorite':''}${t.available?'':' · File unavailable on PC'}`;copy.append(name,detail);
    const star=document.createElement('button');star.textContent=favorites.has(t.id)?'♥':'♡';star.setAttribute('aria-label',(favorites.has(t.id)?'Unfavorite ':'Favorite ')+t.name);star.setAttribute('aria-pressed',String(favorites.has(t.id)));star.onclick=()=>toggleFavorite(t.id);
    star.disabled=pendingFavorites.has(t.id);
    const play=document.createElement('button');play.textContent='▶';play.setAttribute('aria-label','Play '+t.name);play.disabled=!t.available||(!canPlay(t)&&t.id!==lastAudible?.id);play.onclick=()=>{const index=mixer.plan.findIndex(p=>p.track.id===t.id);if(index>=0)selectTrack(index,true)?.catch(e=>status(e.message));};
    row.append(number,copy,star,play);rows.append(row);
  }
  if(!visible.length){const empty=document.createElement('li');empty.className='note';empty.textContent=favoriteOnly?'Tap a heart next to a song to build your favorites list.':'No tracks match your search.';rows.append(empty);}
  renderPairs();
}
function update(){
  const i=mixer.index(),item=mixer.plan[i],time=mixer.time(),next=mixer.plan[i+1];
  $('#play').textContent=mixer.loading?'Loading…':mixer.playing?'Ⅱ Pause':'▶ Play';$('#play').disabled=mixer.loading||!item;
  for(const id of ['#jump','#previous','#next','#seek','#favorite-current'])$(id).disabled=mixer.loading||!item;
  $('#tempo').disabled=mixer.loading||mixer===preview;
  $('#save-transition').disabled=savingPair||!lastPair;
  $('#transition-context').textContent=lastPair?(byTrack.get(lastPair.from)?.name||lastPair.from)+' → '+(byTrack.get(lastPair.to)?.name||lastPair.to)+(mixer===preview?' · preview pairing (not a beatmatched mix)':' · last track handoff'):'Play two tracks in this queue to save a pairing.';
  $('#jump').textContent=mixer===preview?'First chorus':'Jump to mix';
  $('#blend').hidden=mixer===preview;
  document.querySelector('.player>.note').textContent=mixer===preview?'Fast preview plays one original-speed track at a time—no time stretching, beat matching or crossfades. New tracks jump to a named chorus/hook cue when available, otherwise an estimated first chorus. The estimate may not be exact. Scrub anywhere, including back to the intro. Next starts the next track at its preview point.':'Automix prepares pitch-preserving audio at the selected tempo and overlaps tracks. First play may take longer while audio is prepared. Use Fast preview for completely unprocessed tempo and pitch.';
  if(!item){$('#now-title').textContent='Choose a track';$('#now-artist').textContent='Start a playlist to hear your next mix.';$('#next-title').textContent='—';$('#metrics').textContent='32-BEAT AUTOMIX';$('#elapsed').textContent='0:00';$('#duration').textContent='0:00';$('#blend').value=0;$('#mix-state').textContent='';return;}
  $('#now-title').textContent=item.track.name;$('#now-artist').textContent=item.track.artist||'Unknown artist';$('#next-title').textContent=next?.track.name||'End of playlist';
  $('#metrics').textContent=mixer===preview?`FAST PREVIEW · ORIGINAL SPEED · ${item.track.bpm||'?'} BPM · ${preview.cues.get(item.track.id)?.method||'CHORUS PREVIEW'}`:`${mixer.tempo} BPM MIX · ${item.track.key||'KEY UNKNOWN'} · ${item.synced?'BEAT SYNC':'NATURAL SPEED'}`;
  const source=Math.min(item.track.duration,item.source(Math.max(0,time-item.start)));$('#elapsed').textContent=fmt(source);$('#duration').textContent=fmt(item.outro);
  $('#seek').max=item.duration;if(document.activeElement!==$('#seek'))$('#seek').value=Math.max(0,time-item.start);
  const overlap=mixer.plan.filter(p=>p.start<=time&&p.end>time);$('#blend').value=overlap.length===2?gainAt(overlap[1],time):0;$('#mix-state').textContent=overlap.length===2?' / MIXING':'';
  $('#next-label').textContent=overlap.length===2?'MIXING FROM':'UP NEXT';
  if(overlap.length===2)$('#next-title').textContent=overlap[0].track.name;
  $('#favorite-current').textContent=favorites.has(item.track.id)?'♥':'♡';$('#favorite-current').setAttribute('aria-pressed',String(favorites.has(item.track.id)));
  $('#favorite-current').disabled=mixer.loading||pendingFavorites.has(item.track.id);
  if(i!==lastIndex){lastIndex=i;for(const row of document.querySelectorAll('.track'))row.classList.toggle('active',row.dataset.id===item.track.id);}
  if('mediaSession'in navigator){
    if(lastMetadata!==item.track.id&&'MediaMetadata'in window){navigator.mediaSession.metadata=new MediaMetadata({title:item.track.name,artist:item.track.artist||'Pauly Cee',album:'Stream Room'});lastMetadata=item.track.id;}
    navigator.mediaSession.playbackState=mixer.playing?'playing':'paused';
    try{navigator.mediaSession.setPositionState({duration:item.duration,position:Math.max(0,Math.min(item.duration,time-item.start)),playbackRate:1});}catch{}
  }
}
async function connect(){
  if(connecting)return;connecting=true;const button=$('#connection button');button.disabled=true;
  try{
    const url=new URL($('#server').value.trim());if(url.username||url.password||url.search||url.hash)throw Error('Use only the server address, without credentials or query parameters.');
    const loopback=['127.0.0.1','localhost','[::1]'].includes(url.hostname);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&loopback&&location.hostname==='127.0.0.1'))throw Error('Use an HTTPS server address for phone and live website access.');
    server=url.origin;status('Reading your Rekordbox library…');
    const data=await request('/library');if(!Array.isArray(data.tracks)||!Array.isArray(data.playlists))throw Error('The server did not return a Rekordbox library.');
    const previousPlaylist=$('#playlist').value;catalog=data;byTrack=new Map(catalog.tracks.map(t=>[t.id,t]));connected=true;$('#library-source').textContent='REKORDBOX / '+(catalog.name||'LIVE LIBRARY');$('#playlist').replaceChildren(new Option('Full collection','all'),new Option('Good transitions · saved pairs','transitions'));
    try{const saved=JSON.parse(sessionStorage.getItem('pauly-stream-heard:v1')||'[]');heard=new Set(Array.isArray(saved)?saved.filter(id=>typeof id==='string'):[]);}catch{heard=new Set();}
    try{const prefs=JSON.parse(sessionStorage.getItem('pauly-stream-discovery:'+server)||'{}');if(['regular','shuffle','harmonic'].includes(prefs.order))$('#queue-order').value=prefs.order;$('#skip-favorites').checked=prefs.skip===true;}catch{}
    await favoriteWrites;await loadFavorites(true);
    await loadTransitions();
    for(const p of catalog.playlists)$('#playlist').add(new Option(p.name,p.id));
    if([...$('#playlist').options].some(p=>p.value===previousPlaylist))$('#playlist').value=previousPlaylist;
    const first=catalog.tracks.find(t=>t.available&&t.bpm>=60&&t.bpm<=180);$('#tempo').value=first?.bpm||120;
    $('#connect').hidden=true;$('#room').hidden=false;$('#disconnect').hidden=false;
    try{sessionStorage.removeItem('pauly-stream-connection');}catch{}
    applyPlaylist();status(`${catalog.tracks.length} tracks · ${catalog.playlists.length} playlists · ${catalog.tracks.filter(t=>!t.available).length} unavailable on PC. Global favorites saved on the server.`);
  }catch(e){status(e.message);}finally{connecting=false;button.disabled=false;}
}
$('#connection').onsubmit=e=>{e.preventDefault();connect();};
$('#disconnect').onclick=()=>{for(const r of requests)r.abort();mixer.clear();connected=false;catalog={tracks:[],playlists:[]};$('#room').hidden=true;$('#connect').hidden=false;$('#disconnect').hidden=true;if('mediaSession'in navigator){navigator.mediaSession.metadata=null;navigator.mediaSession.playbackState='none';}status('Disconnected. Global favorites are saved on the server.');};
$('#refresh').onclick=async()=>{if(mixer.loading){status('Wait for the current track to finish loading before refreshing.');return;}mixer.pause();$('#server').value=server;await connect();};
$('#playlist').onchange=applyPlaylist;
$('#favorites').onclick=()=>{favoriteOnly=!favoriteOnly;filters.hidden=!favoriteOnly;$('#favorites').setAttribute('aria-pressed',String(favoriteOnly));applyPlaylist();};
$('#search').oninput=e=>{rowLimit=200;query=e.target.value.trim().toLowerCase();renderRows();};
$('#load-more').onclick=()=>{rowLimit+=200;renderRows();};
$('#play').onclick=()=>{if(mixer.playing)mixer.pause();else{status('Preparing audio from your PC…');mixer.play().then(()=>{if(mixer.playing)status(mixer===preview?'Fast preview · original audio at 1× speed · no mixing.':'Streaming from PC · automatic transitions.');});}};
function navigate(direction){for(let i=mixer.index()+direction;i>=0&&i<mixer.plan.length;i+=direction)if(canPlay(mixer.plan[i].track))return selectTrack(i,true);status('No unheard eligible tracks in that direction. Reset session history to sample again.');}
$('#previous').onclick=()=>navigate(-1);$('#next').onclick=()=>navigate(1);
$('#jump').onclick=()=>{if(mixer===preview)return preview.jumpChorus();const next=mixer.plan.slice(mixer.index()+1).find(p=>canPlay(p.track));if(next)mixer.seek(next.start,true);else status('No unheard eligible next transition in this playlist.');};
$('#seek').onchange=e=>{const item=mixer.plan[mixer.index()];if(item)mixer.seek(item.start+Number(e.target.value));};
$('#volume').oninput=e=>mixer.setVolume(Number(e.target.value));
$('#tempo').onchange=()=>{const tempo=Number($('#tempo').value);if(!Number.isFinite(tempo)||tempo<60||tempo>180){$('#tempo').value=mixer.tempo;status('Choose a tempo between 60 and 180 BPM.');return;}const current=byTrack.get(mixer.plan[mixer.index()]?.track.id),playing=mixer.playing;if(current){mixer.setQueue([current,...ordered(remaining().filter(t=>t.id!==current.id))],tempo);mixer.resumeId=current.id;mixer.seek(0,playing);}status('Mix tempo changed; restarted the current track.');};
$('#favorite-current').onclick=()=>toggleFavorite(mixer.plan[mixer.index()]?.track.id);
if('mediaSession'in navigator)for(const [action,handler]of Object.entries({play:()=>mixer.play(),pause:()=>mixer.pause(),nexttrack:()=>$('#next').click(),previoustrack:()=>$('#previous').click(),seekto:e=>{const p=mixer.plan[mixer.index()];if(p)mixer.seek(p.start+e.seekTime);},seekbackward:e=>mixer.seek(Math.max(mixer.plan[mixer.index()]?.start||0,mixer.time()-(e.seekOffset||15))),seekforward:e=>mixer.seek(Math.min((mixer.plan[mixer.index()]?.end||0)-.01,mixer.time()+(e.seekOffset||15)))}))try{navigator.mediaSession.setActionHandler(action,handler);}catch{}
setInterval(()=>{if(mixer.playing)update();},250);update();
setInterval(()=>{if(connected&&!document.hidden){loadFavorites().catch(()=>{});loadTransitions().catch(()=>{});}},15000);
window.addEventListener('focus',()=>{if(connected){loadFavorites().catch(()=>{});loadTransitions().catch(()=>{});}});
const fragment=new URLSearchParams(location.hash.slice(1));
if(fragment.has('key'))history.replaceState(null,'',location.pathname);
const configuration=fragment.has('server')?Promise.resolve({server:fragment.get('server')}):fetch('connection.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('No server configured.');return r.json();});
configuration.then(c=>{$('#server').value=c.server;return connect();}).catch(()=>status('The music server is offline. Try connecting again shortly.'));
