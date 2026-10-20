import {StreamMixer,gainAt} from './mixer.js?v=20261020-smooth-buffer';
import {favoriteOrder} from './order.js';
const $=s=>document.querySelector(s),status=t=>{$('#status').textContent=t;};
const fmt=n=>{n=Math.max(0,Math.floor(n||0));return Math.floor(n/60)+':'+String(n%60).padStart(2,'0');};
let server='',catalog={tracks:[],playlists:[]},visible=[],favoriteOnly=false,query='',connected=false,lastIndex=-1,lastMetadata='',connecting=false,rowLimit=200;
let favorites=new Set(),favoriteWrites=Promise.resolve(),syncingFavorites=false;
const pendingFavorites=new Set();
const requests=new Set();
const filters=document.createElement('div');filters.className='toolbar';filters.hidden=true;
filters.innerHTML='<label>Favorites order<select id="favorite-sort"><option value="bpm-asc">BPM: slowest first</option><option value="bpm-desc">BPM: fastest first</option><option value="key-asc">Key: Camelot ascending</option><option value="key-desc">Key: Camelot descending</option></select></label><label>Min BPM<input id="bpm-min" type="number" min="1" max="300" placeholder="Any"></label><label>Max BPM<input id="bpm-max" type="number" min="1" max="300" placeholder="Any"></label><label>Key<select id="key-filter"><option value="">All keys</option><option value="unknown">Unknown key</option></select></label>';
document.querySelector('.toolbar').after(filters);
for(let n=1;n<=12;n++)for(const letter of ['A','B'])$('#key-filter').add(new Option(n+letter,n+letter));
for(const input of filters.querySelectorAll('input,select'))input.onchange=()=>applyPlaylist();
document.querySelector('.player>.note').textContent='Your PC automatically checks intro/outro beats and prepares pitch-preserving audio at a steady mix tempo. Confident grids use 32-beat blends; uncertain tracks use a shorter bass-managed transition. First play may take longer while audio is prepared and cached. Keep this page open for mixing; screen-lock playback is browser-dependent.';
async function request(path,kind='json',options={}){
  if(!connected&&path!='/library')throw Error('Connect to your PC first.');
  const controller=new AbortController();requests.add(controller);const timer=setTimeout(()=>controller.abort(),180000);
  try{const response=await fetch(server+path,{...options,signal:controller.signal,cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
    if(response.status===404)throw Error(path.startsWith('/favorites')?'Favorites are unavailable. Refresh the page or restart the updated PC server.':'This audio file is missing from the PC. Reconnect its drive or relocate it in Rekordbox.');
    if(!response.ok)throw Error('PC server could not serve this request ('+response.status+').');return kind==='audio'?await response.arrayBuffer():await response.json();
  }catch(e){if(e instanceof TypeError)throw Error('Cannot reach your PC. Check that the server and secure connection are running and that the PC is awake.');if(e.name==='AbortError')throw Error('Connection cancelled or timed out. Try again.');throw e;}
  finally{clearTimeout(timer);requests.delete(controller);}
}
const mixer=new StreamMixer({url:track=>server+'/audio/'+encodeURIComponent(track.id)+'?tempo='+mixer.tempo,prepareTrack:(track,tempo)=>request('/prepare/'+encodeURIComponent(track.id)+'?tempo='+tempo),onchange:()=>update(),onerror:e=>status(e.message)});
async function loadFavorites(migrate=false){
  if(syncingFavorites||pendingFavorites.size||!connected)return;syncingFavorites=true;
  try{
    let legacy=[];if(migrate)try{const saved=JSON.parse(localStorage.getItem('pauly-stream-favorites')||'[]');if(Array.isArray(saved))legacy=saved.filter(id=>typeof id==='string');}catch{}
    const data=legacy.length?await request('/favorites/import','json',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:legacy})}):await request('/favorites');
    if(!Array.isArray(data.ids))throw Error('The server did not return a favorites list.');
    favorites=new Set(data.ids);if(migrate)try{localStorage.removeItem('pauly-stream-favorites');}catch{}
    if(!$('#room').hidden){renderRows();update();}
  }finally{syncingFavorites=false;}
}
function toggleFavorite(id){
  if(!id||pendingFavorites.has(id))return;const favorite=!favorites.has(id);pendingFavorites.add(id);renderRows();update();
  favoriteWrites=favoriteWrites.then(async()=>{
    try{const data=await request('/favorites/'+encodeURIComponent(id),'json',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({favorite})});favorites=new Set(data.ids);status(favorite?'Added to global favorites.':'Removed from global favorites.');}
    catch(e){status('Could not save global favorites: '+e.message);}
    finally{pendingFavorites.delete(id);if(connected){renderRows();update();}}
  });
}
function playlistTracks(){if(favoriteOnly)return favoriteOrder(catalog.tracks.filter(t=>favorites.has(t.id)),{sort:$('#favorite-sort').value,min:$('#bpm-min').value,max:$('#bpm-max').value,key:$('#key-filter').value});const chosen=$('#playlist').value;const byid=new Map(catalog.tracks.map(t=>[t.id,t]));const ids=chosen==='all'?catalog.tracks.map(t=>t.id):catalog.playlists.find(p=>p.id===chosen)?.tracks||[];return ids.map(id=>byid.get(id)).filter(Boolean);}
function applyPlaylist(){rowLimit=200;mixer.setQueue(playlistTracks().filter(t=>t.available&&t.duration>0),Number($('#tempo').value));lastIndex=-1;renderRows();status(mixer.plan.length+' playable tracks in this queue. Filters and sorting set playback order; press Play to begin.');}
function renderRows(){
  visible=playlistTracks().filter(t=>!query||(t.name+' '+t.artist).toLowerCase().includes(query));const rows=$('#tracks');rows.replaceChildren();
  $('#queue-title').textContent=favoriteOnly?'Global favorites':$('#playlist').selectedOptions[0]?.textContent||'Collection';
  $('#count').textContent=visible.length+' tracks';$('#favorite-count').textContent=favorites.size;
  const current=mixer.plan[mixer.index()]?.track.id;
  $('#load-more').hidden=visible.length<=rowLimit;
  for(const [i,t]of visible.slice(0,rowLimit).entries()){
    const row=document.createElement('li');row.className='track'+(t.id===current?' active':'')+(!t.available?' missing':'');row.dataset.id=t.id;
    const number=document.createElement('span');number.className='number';number.textContent=String(i+1).padStart(2,'0');
    const copy=document.createElement('div'),name=document.createElement('strong'),detail=document.createElement('small');name.textContent=t.name;detail.textContent=`${t.artist||'Unknown artist'} · ${t.bpm||'?'} BPM · ${t.key||'Key unknown'} · ${fmt(t.duration)}${t.available?'':' · File unavailable on PC'}`;copy.append(name,detail);
    const star=document.createElement('button');star.textContent=favorites.has(t.id)?'♥':'♡';star.setAttribute('aria-label',(favorites.has(t.id)?'Unfavorite ':'Favorite ')+t.name);star.setAttribute('aria-pressed',String(favorites.has(t.id)));star.onclick=()=>toggleFavorite(t.id);
    star.disabled=pendingFavorites.has(t.id);
    const play=document.createElement('button');play.textContent='▶';play.setAttribute('aria-label','Play '+t.name);play.disabled=!t.available;play.onclick=()=>{const index=mixer.plan.findIndex(p=>p.track.id===t.id);if(index>=0)mixer.seek(mixer.plan[index].start,true).catch(e=>status(e.message));};
    row.append(number,copy,star,play);rows.append(row);
  }
  if(!visible.length){const empty=document.createElement('li');empty.className='note';empty.textContent=favoriteOnly?'Tap a heart next to a song to build your favorites list.':'No tracks match your search.';rows.append(empty);}
}
function update(){
  const i=mixer.index(),item=mixer.plan[i],time=mixer.time(),next=mixer.plan[i+1];
  $('#play').textContent=mixer.loading?'Loading…':mixer.playing?'Ⅱ Pause':'▶ Play';$('#play').disabled=mixer.loading||!item;
  for(const id of ['#jump','#previous','#next','#seek','#favorite-current'])$(id).disabled=mixer.loading||!item;
  $('#tempo').disabled=mixer.loading;
  if(!item){$('#now-title').textContent='Choose a track';$('#now-artist').textContent='Start a playlist to hear your next mix.';$('#next-title').textContent='—';$('#metrics').textContent='32-BEAT AUTOMIX';$('#elapsed').textContent='0:00';$('#duration').textContent='0:00';$('#blend').value=0;$('#mix-state').textContent='';return;}
  $('#now-title').textContent=item.track.name;$('#now-artist').textContent=item.track.artist||'Unknown artist';$('#next-title').textContent=next?.track.name||'End of playlist';
  $('#metrics').textContent=`${mixer.tempo} BPM MIX · ${item.track.key||'KEY UNKNOWN'} · ${item.synced?'BEAT SYNC':'NATURAL SPEED'}`;
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
    const previousPlaylist=$('#playlist').value;catalog=data;connected=true;$('#library-source').textContent='REKORDBOX / '+(catalog.name||'LIVE LIBRARY');$('#playlist').replaceChildren(new Option('Full collection','all'));
    await favoriteWrites;await loadFavorites(true);
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
$('#play').onclick=()=>{if(mixer.playing)mixer.pause();else{if(favoriteOnly&&playlistTracks().filter(t=>t.available&&t.duration>0).map(t=>t.id).join(',')!==mixer.tracks.map(t=>t.id).join(','))applyPlaylist();status('Preparing audio from your PC…');mixer.play().then(()=>{if(mixer.playing)status('Streaming from PC · 32-beat automix.');});}};
$('#previous').onclick=()=>mixer.seek(mixer.plan[Math.max(0,mixer.index()-1)]?.start||0,true);
$('#next').onclick=()=>{const next=mixer.plan[mixer.index()+1];if(next)mixer.seek(next.start,true);else status('You are at the last track.');};
$('#jump').onclick=()=>{const next=mixer.plan[mixer.index()+1];if(next)mixer.seek(next.start,true);else status('No next transition in this playlist.');};
$('#seek').onchange=e=>{const item=mixer.plan[mixer.index()];if(item)mixer.seek(item.start+Number(e.target.value));};
$('#volume').oninput=e=>mixer.setVolume(Number(e.target.value));
$('#tempo').onchange=()=>{const tempo=Number($('#tempo').value);if(!Number.isFinite(tempo)||tempo<60||tempo>180){$('#tempo').value=mixer.tempo;status('Choose a tempo between 60 and 180 BPM.');return;}const index=mixer.index(),playing=mixer.playing;mixer.setQueue(mixer.tracks,tempo);mixer.seek(mixer.plan[index]?.start||0,playing);status('Mix tempo changed; restarted the current track.');};
$('#favorite-current').onclick=()=>toggleFavorite(mixer.plan[mixer.index()]?.track.id);
if('mediaSession'in navigator)for(const [action,handler]of Object.entries({play:()=>mixer.play(),pause:()=>mixer.pause(),nexttrack:()=>$('#next').click(),previoustrack:()=>$('#previous').click()}))try{navigator.mediaSession.setActionHandler(action,handler);}catch{}
setInterval(()=>{if(mixer.playing)update();},250);update();
setInterval(()=>{if(connected&&!document.hidden)loadFavorites().catch(()=>{});},15000);
window.addEventListener('focus',()=>{if(connected)loadFavorites().catch(()=>{});});
const fragment=new URLSearchParams(location.hash.slice(1));
if(fragment.has('key'))history.replaceState(null,'',location.pathname);
const configuration=fragment.has('server')?Promise.resolve({server:fragment.get('server')}):fetch('connection.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('No server configured.');return r.json();});
configuration.then(c=>{$('#server').value=c.server;return connect();}).catch(()=>status('The music server is offline. Try connecting again shortly.'));
