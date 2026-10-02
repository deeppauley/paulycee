// The repository token is used only for this explicit owner action and never persisted.
export async function publishLibrary({token,key,plain=false,tracks,name,libraryVersion,readFile,status}) {
  if(!plain&&!key)throw Error('Unlock the hosted library before publishing additions.');
  if(!token.trim())throw Error('A repository-scoped GitHub token is required to publish.');
  const api='https://api.github.com/repos/deeppauley/paulycee';
  async function request(path,method='GET',body){const r=await fetch(api+path,{method,headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token.trim(),'X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error(`GitHub returned ${r.status}. Check repository Contents write access; if the branch changed, reload and retry.`);return r.json();}
  async function seal(data){const iv=crypto.getRandomValues(new Uint8Array(12)),sealed=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,data));const all=new Uint8Array(12+sealed.length);all.set(iv);all.set(sealed,12);return all;}
  async function blob(data){let binary='';for(let i=0;i<data.length;i+=16384)binary+=String.fromCharCode(...data.subarray(i,i+16384));return request('/git/blobs','POST',{content:btoa(binary),encoding:'base64'});}
  const additions=tracks.filter(t=>t.local);if(!additions.length)throw Error('Import audio files before publishing additions.');
  const ref=await request('/git/ref/heads/main'),parent=ref.object.sha,commit=await request('/git/commits/'+parent);
  const manifestFile=plain?'library.json':'library.bin';
  const existing=await request('/contents/practice/library/'+manifestFile+'?ref='+parent);
  if(!existing.content)throw Error('Cannot verify the current library. Retry after deployment.');
  const current=Uint8Array.from(atob(existing.content.replace(/\s/g,'')),c=>c.charCodeAt(0));
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',current))).map(b=>b.toString(16).padStart(2,'0')).join('');
  if(digest!==libraryVersion)throw Error('The hosted playlist changed since you unlocked it. Reload and unlock before publishing so no tracks are lost. Your imported files remain on this device.');
  const tree=[],published=[];
  for(const t of tracks){if(!t.local){published.push(t);continue;}status(`${plain?'Uploading':'Encrypting and uploading'} track ${published.length+1}/${tracks.length}…`);const f=await readFile(t.id);if(!f)throw Error('An imported audio file is missing from browser storage.');if(f.size>70*1024*1024)throw Error('Use MP3/AAC files under 70 MB for browser publishing. Larger originals can use the desktop packager.');
    const ext=(t.filename||'').split('.').at(-1).toLowerCase();
    if(plain&&!['mp3','m4a','aac','wav','flac','aif','aiff','ogg'].includes(ext))throw Error('Choose a supported audio file extension before publishing.');
    const filename=crypto.randomUUID()+(plain?'.'+ext:'.bin');const raw=await f.arrayBuffer();const bytes=plain?new Uint8Array(raw):await seal(raw);const b=await blob(bytes);tree.push({path:'practice/library/'+filename,mode:'100644',type:'blob',sha:b.sha});const {local,filename:original,...safe}=t;published.push({...safe,file:filename});}
  const json=new TextEncoder().encode(JSON.stringify({version:plain?2:1,...(plain?{encrypted:false}:{}),name,tracks:published}));
  const metadata=await blob(plain?json:await seal(json));tree.push({path:'practice/library/'+manifestFile,mode:'100644',type:'blob',sha:metadata.sha});
  const updated=await request('/git/trees','POST',{base_tree:commit.tree.sha,tree});
  const next=await request('/git/commits','POST',{message:plain?'Update practice playlist':'Update encrypted practice library',tree:updated.sha,parents:[parent]});
  await request('/git/refs/heads/main','PATCH',{sha:next.sha,force:false});
  return next.sha;
}
