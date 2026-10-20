import {grid,beatAt,sourceAt,gainAt} from '../practice/mix.js';

// A shared tempo makes both grids run on the same clock throughout the overlap.
export function makeStreamPlan(tracks,tempo){
  const plan=[];
  for(const track of tracks){
    const gs=grid(track),synced=gs.length>0;
    const intro=Math.max(0,Math.min(track.intro||0,track.duration-.1));
    const base=synced?beatAt(gs,intro):0;
    let outro=track.mixOutro||track.duration;
    if(synced&&!track.prepared)outro=sourceAt(gs,base+Math.floor((beatAt(gs,outro)-base)/4)*4);
    if(outro<=intro)outro=track.duration;
    const duration=synced?(beatAt(gs,outro)-base)*60/tempo:outro-intro;
    const previous=plan.at(-1);
    // Short clips cannot supply 32 beats: use as much as half of either clip.
    const overlap=previous?Math.min(Math.min(track.mixBeats||32,previous.track.mixBeats||32)*60/tempo,duration/2,previous.duration/2):0;
    const start=previous?previous.end-overlap:0;
    const item={track,gs,synced,intro,outro,base,duration,start,end:start+duration,fadeIn:overlap,fadeOut:0,index:plan.length};
    item.source=local=>synced?sourceAt(gs,base+local*tempo/60):intro+local;
    item.local=source=>synced?(beatAt(gs,source)-base)*60/tempo:source-intro;
    if(previous)previous.fadeOut=overlap;
    plan.push(item);
  }
  return plan;
}
export {gainAt};
export function bassAt(item,time){
  if(item.fadeIn&&time<item.start+item.fadeIn)return -24*(1-Math.min(1,Math.max(0,(time-item.start)/item.fadeIn*2-1)));
  if(item.fadeOut&&time>item.end-item.fadeOut)return -24*Math.min(1,Math.max(0,(time-(item.end-item.fadeOut))/item.fadeOut*2));
  return 0;
}

export class StreamMixer{
  constructor({url,prepareTrack,onchange,onerror}){this.url=url;this.prepareTrack=prepareTrack;this.onchange=onchange;this.onerror=onerror;this.decks=[];this.failed=new Set();this.plan=[];this.tempo=120;this.offset=0;this.playing=false;this.epoch=0;this.volume=.8;this.loading=false;}
  context(){
    if(!this.ctx){
      this.ctx=new AudioContext();this.master=this.ctx.createGain();this.master.gain.value=this.volume;this.master.connect(this.ctx.destination);
      for(let i=0;i<2;i++){
        const audio=new Audio();audio.crossOrigin='anonymous';audio.preload='auto';audio.preservesPitch=true;audio.setAttribute('playsinline','');
        const source=this.ctx.createMediaElementSource(audio),gain=this.ctx.createGain(),bass=this.ctx.createBiquadFilter();bass.type='lowshelf';bass.frequency.value=180;gain.gain.value=0;source.connect(bass);bass.connect(gain);gain.connect(this.master);
        const deck={audio,gain,bass,item:null,starting:false};this.decks.push(deck);
        audio.addEventListener('ended',()=>{
          if(!this.playing||deck.starting)return;
          const next=deck.item?.index+1;
          if(this.failed.has(next))this.skipFailed(next);
        });
        audio.addEventListener('error',()=>{if(this.playing&&!deck.starting&&deck.item&&this.time()>=deck.item.start&&this.time()<deck.item.end)this.fail(Error('Audio stream was interrupted. Press Play to retry.'));});
        audio.addEventListener('waiting',()=>{
          clearTimeout(deck.bufferTimer);
          deck.bufferTimer=setTimeout(()=>{
            if(!this.playing||deck.starting||audio.seeking||audio.readyState>=3||!deck.item||this.time()<deck.item.start)return;
            this.pause();const token=this.epoch;this.loading=true;this.onchange();this.onerror(Error('Buffering audio from the PC…'));
            this.buffered(deck,token).then(()=>{if(this.epoch===token){this.loading=false;this.play();}}).catch(e=>{if(this.epoch===token)this.fail(e);});
          },400);
        });
      }
    }
    return this.ctx;
  }
  time(){
    // Follow the audible outgoing transport, not a second clock that may drift on iOS.
    if(this.playing){
      const d=this.decks.filter(d=>d.item&&!d.audio.paused&&!d.starting&&d.audio.currentTime<d.item.outro-.02).sort((a,b)=>a.item.index-b.item.index)[0];
      if(d)return Math.max(0,d.item.start+d.item.local(d.audio.currentTime));
      return Math.max(0,this.offset+this.ctx.currentTime-this.anchor);
    }
    return this.offset;
  }
  index(){return (this.plan.findLast(p=>p.start<=this.time()+.001)||this.plan[0])?.index||0;}
  setQueue(tracks,tempo=this.tempo){this.pause();this.unload();this.tempo=tempo;this.tracks=tracks.map(t=>{const original=t._original||t;return {...original,_original:original};});this.plan=makeStreamPlan(this.tracks,tempo);this.offset=0;this.failed.clear();this.onchange();}
  prepare(item){
    this.context();const deck=this.decks[item.index%2];if(deck.item===item)return deck;
    deck.audio.pause();deck.item=item;deck.error=null;deck.gain.gain.cancelScheduledValues(this.ctx.currentTime);deck.gain.gain.value=0;
    const audio=deck.audio;
    const queue=this.plan;
    deck.ready=(async()=>{
      if(this.prepareTrack&&!item.track.prepared){
        const data=await this.prepareTrack(item.track,this.tempo);
        if(this.plan!==queue||deck.item!==item)throw Error('Track changed.');
        Object.assign(item.track,data);
        const rebuilt=makeStreamPlan(this.tracks,this.tempo);
        for(let i=0;i<queue.length;i++)Object.assign(queue[i],rebuilt[i]);
        if(this.playing){const time=this.time();for(const d of this.decks)if(d.item&&!d.audio.paused)this.envelope(d,time);}
      }
      if(deck.item!==item)throw Error('Track changed.');
      return new Promise((resolve,reject)=>{
      const clear=()=>{clearTimeout(timer);audio.removeEventListener('loadedmetadata',ready);audio.removeEventListener('error',error);audio.removeEventListener('emptied',cancel);};
      const ready=()=>{clear();resolve();};const error=()=>{clear();reject(Error('This track cannot stream. Check its source file on the PC.'));};
      const cancel=()=>{if(deck.item!==item){clear();reject(Error('Track changed.'));}};
      const timer=setTimeout(()=>{clear();reject(Error('The PC took too long to prepare this track.'));},60000);
      audio.addEventListener('loadedmetadata',ready);audio.addEventListener('error',error);audio.addEventListener('emptied',cancel);
      audio.src=this.url(item.track);audio.load();
      });
    })();
    deck.ready.catch(error=>{if(deck.item===item)deck.error=error;});return deck;
  }
  pause(){this.offset=this.time();this.playing=false;this.loading=false;this.epoch++;clearInterval(this.timer);for(const d of this.decks){clearTimeout(d.bufferTimer);d.audio.pause();d.gain.gain.cancelScheduledValues(this.ctx.currentTime);d.gain.gain.value=0;}this.wake?.release().catch(()=>{});this.wake=null;this.onchange();}
  unload(){for(const d of this.decks){d.item=null;d.audio.removeAttribute('src');d.audio.load();}}
  clear(){this.pause();this.unload();this.plan=[];this.tracks=[];this.offset=0;this.onchange();}
  rate(item,position){return item.track.prepared?1:item.synced?this.tempo/(item.track.bpm||this.tempo):1;}
  envelope(deck,time){
    deck.bass.gain.setValueAtTime(bassAt(deck.item,time),this.ctx.currentTime);
    const item=deck.item,ctx=this.ctx,start=Math.max(time,item.start),param=deck.gain.gain;param.cancelScheduledValues(ctx.currentTime);
    const ramp=(from,to)=>{from=Math.max(from,start);if(to<=from)return;const curve=Float32Array.from({length:128},(_,i)=>gainAt(item,from+(to-from)*i/127));param.setValueCurveAtTime(curve,ctx.currentTime+Math.max(0,from-time),to-from);};
    if(item.fadeIn&&start<item.start+item.fadeIn)ramp(item.start,item.start+item.fadeIn);
    else if(!(item.fadeOut&&start>=item.end-item.fadeOut))param.setValueAtTime(gainAt(item,start),ctx.currentTime);
    ramp(item.end-item.fadeOut,item.end);
  }
  async buffered(deck,token){
    const audio=deck.audio,deadline=performance.now()+20000;
    while(token===this.epoch){
      if(audio.error)throw Error('Audio buffering failed. Press Play to retry.');
      const position=audio.currentTime,needed=Math.min(3,Math.max(0,audio.duration-position-.05));
      for(let i=0;i<audio.buffered.length;i++)if(!audio.seeking&&audio.buffered.start(i)<=position+.05&&audio.buffered.end(i)>=position+needed)return;
      if(performance.now()>deadline){if(audio.readyState>=3)return;throw Error('The connection is too slow to buffer audio. Press Play to retry.');}
      await new Promise(resolve=>setTimeout(resolve,80));
    }
  }
  async startDeck(item,token){
    const deck=this.prepare(item);if(deck.starting)return;deck.starting=true;
    try{
      await deck.ready;if(token!==this.epoch||deck.item!==item)return;
      const position=Math.min(deck.audio.duration-.01,Math.max(0,item.source(Math.max(0,this.time()-item.start))));
      deck.audio.currentTime=position;deck.audio.playbackRate=this.rate(item,position);
      await this.buffered(deck,token);if(token!==this.epoch)return;
      await deck.audio.play();if(token!==this.epoch){deck.audio.pause();return;}
      // Catch up to the shared beat clock if the browser needed time to start.
      const expected=item.source(Math.max(0,this.time()-item.start));
      if(!this.loading&&Math.abs(deck.audio.currentTime-expected)>.06)deck.audio.currentTime=Math.min(deck.audio.duration-.01,expected);
      this.envelope(deck,this.time());
    }finally{deck.starting=false;}
  }
  skipFailed(index){const next=this.plan.slice(index+1).find(p=>!this.failed.has(p.index));if(next)this.seek(next.start,true);else{this.pause();this.onerror(Error('No more playable tracks in this queue.'));}}
  preloadNext(){const next=this.plan[this.index()+1];
    // During an overlap both decks are occupied; wait to reuse the outgoing deck.
    if(this.plan.filter(p=>p.start<=this.time()&&p.end>this.time()).length>1)return;
    const plan=this.plan;
    if(next&&!this.failed.has(next.index))this.prepare(next).ready.catch(()=>{if(this.plan===plan&&!this.failed.has(next.index)){this.failed.add(next.index);this.onerror(Error('Next track is unavailable; the current song will keep playing.'));}});
  }
  async play(){
    if(this.loading||this.playing||!this.plan.length)return;
    this.loading=true;const token=++this.epoch;this.onchange();
    try{
      try{if(navigator.audioSession)navigator.audioSession.type='playback';}catch{}
      await this.context().resume();if(this.offset>=this.plan.at(-1).end)this.offset=0;
      let active=this.plan.filter(p=>p.start<=this.offset+.001&&p.end>this.offset);
      const selected=this.index(),selectedLocal=this.offset-this.plan[selected].start;
      await Promise.all(active.map(p=>this.prepare(p).ready));if(token!==this.epoch)return;
      this.offset=this.plan[selected].start+selectedLocal;
      // Native media buffering avoids allocating two full decoded tracks in memory.
      const index=this.index(),local=this.offset-this.plan[index].start;let changed=false;
      for(const p of active){const actual=this.decks[p.index%2].audio.duration;if(Number.isFinite(actual)&&Math.abs(actual-p.track.duration)>.05){p.track.duration=actual;changed=true;}}
      if(changed){this.plan=makeStreamPlan(this.tracks,this.tempo);this.offset=this.plan[index].start+local;active=this.plan.filter(p=>p.start<=this.offset+.001&&p.end>this.offset);for(const p of active)this.decks[p.index%2].item=p;}
      this.anchor=this.ctx.currentTime;this.playing=true;
      await Promise.all(active.map(p=>this.startDeck(p,token)));if(token!==this.epoch)return;
      const reference=this.decks[active[0].index%2];this.anchor=this.offset+this.ctx.currentTime-reference.item.start-reference.item.local(reference.audio.currentTime);
      for(const p of active)this.envelope(this.decks[p.index%2],this.time());
      this.timer=setInterval(()=>this.tick(),100);this.preloadNext();
      if('wakeLock'in navigator)navigator.wakeLock.request('screen').then(w=>{if(this.playing)this.wake=w;else w.release();}).catch(()=>{});
    }catch(e){if(token===this.epoch)this.fail(e);}finally{this.loading=false;this.onchange();}
  }
  fail(e){this.pause();this.onerror(e);}
  tick(){
    if(!this.playing)return;const token=this.epoch;
      const time=this.time();if(time>=this.plan.at(-1).end){this.pause();this.offset=this.plan.at(-1).end;this.onchange();return;}
      for(const d of this.decks)if(d.item&&time>=d.item.end){d.audio.pause();d.gain.gain.cancelScheduledValues(this.ctx.currentTime);d.gain.gain.value=0;}
      const active=this.plan.filter(p=>p.start<=time&&p.end>time);
      for(const item of active){
        if(this.failed.has(item.index)){if(active.length===1)this.skipFailed(item.index);continue;}
        const d=this.prepare(item);
        if(d.audio.paused&&!d.starting)this.startDeck(item,token).catch(e=>{if(token===this.epoch){this.failed.add(item.index);this.onerror(e);if(this.time()>=item.end)this.skipFailed(item.index);}});
        else if(!d.starting){
          // Do not servo playbackRate: repeated corrections cause audible pitch/tempo hunting.
          // The PC renders a steady, pitch-preserving tempo before streaming.
          d.bass.gain.setTargetAtTime(bassAt(item,time),this.ctx.currentTime,.04);
        }
      }
      this.preloadNext();
  }
  async seek(time,autoplay=this.playing){this.pause();this.offset=Math.max(0,Math.min(this.plan.at(-1)?.end||0,time));this.onchange();if(autoplay)await this.play();}
  setVolume(value){this.volume=value;if(this.master)this.master.gain.setTargetAtTime(value,this.ctx.currentTime,.02);}
}
