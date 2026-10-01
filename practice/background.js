// Native media playback stays independent of the foreground Web Audio mixer.
export class BackgroundPlayer {
  constructor({read, onended, onstate, onerror}) {
    this.read=read; this.urls=new Map(); this.pending=new Map(); this.generation=0;
    this.audio=document.createElement('audio');
    this.audio.preload='auto'; this.audio.setAttribute('playsinline','');
    this.audio.hidden=true; document.body.append(this.audio);
    this.audio.addEventListener('ended',onended);
    for(const event of ['play','pause','timeupdate','loadedmetadata'])
      this.audio.addEventListener(event,()=>onstate(this.audio));
    this.audio.addEventListener('error',()=>onerror(Error('Audio could not play. Reopen the page and try Play again.')));
  }
  async prepare(track) {
    if(this.urls.has(track.id))return this.urls.get(track.id);
    if(this.pending.has(track.id))return this.pending.get(track.id);
    const generation=this.generation;
    const task=this.read(track).then(blob=>{
      if(generation!==this.generation)throw Error('Playback cancelled.');
      const url=URL.createObjectURL(blob);this.urls.set(track.id,url);return url;
    });
    this.pending.set(track.id,task);
    try{return await task;}finally{if(this.pending.get(track.id)===task)this.pending.delete(track.id);}
  }
  async play(track,position,isCurrent) {
    try{if(navigator.audioSession)navigator.audioSession.type='playback';}catch{}
    const url=await this.prepare(track);if(!isCurrent())return;
    if(this.audio.src!==url){this.audio.src=url;this.audio.load();}
    this.audio.currentTime=position;
    await this.audio.play();
    if(!isCurrent())this.audio.pause();
  }
  retain(tracks) {
    const ids=new Set(tracks.filter(Boolean).map(t=>t.id));
    for(const [id,url] of this.urls)if(!ids.has(id)){URL.revokeObjectURL(url);this.urls.delete(id);}
  }
  clear(){this.generation++;this.audio.pause();this.audio.removeAttribute('src');this.audio.load();for(const url of this.urls.values())URL.revokeObjectURL(url);this.urls.clear();this.pending.clear();}
}
