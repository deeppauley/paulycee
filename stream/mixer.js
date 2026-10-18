import {grid,beatAt,sourceAt,gainAt} from '../practice/mix.js';

// A shared tempo makes both grids run on the same clock throughout the overlap.
export function makeStreamPlan(tracks,tempo){
  const plan=[];
  for(const track of tracks){
    const gs=grid(track),synced=gs.length>0;
    const intro=Math.max(0,Math.min(track.intro||0,track.duration-.1));
    const base=synced?beatAt(gs,intro):0;
    let outro=track.duration;
    if(synced)outro=sourceAt(gs,base+Math.floor((beatAt(gs,outro)-base)/4)*4);
    if(outro<=intro)outro=track.duration;
    const duration=synced?(beatAt(gs,outro)-base)*60/tempo:outro-intro;
    const previous=plan.at(-1);
    // Short clips cannot supply 32 beats: use as much as half of either clip.
    const overlap=previous?Math.min(32*60/tempo,duration/2,previous.duration/2):0;
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

export class StreamMixer{
  constructor({load,onchange,onerror}){this.load=load;this.onchange=onchange;this.onerror=onerror;this.buffers=new Map();this.pending=new Map();this.voices=new Map();this.plan=[];this.tempo=120;this.offset=0;this.playing=false;this.epoch=0;this.volume=.8;this.loading=false;}
  context(){if(!this.ctx){this.ctx=new AudioContext();this.master=this.ctx.createGain();this.master.gain.value=this.volume;this.master.connect(this.ctx.destination);}return this.ctx;}
  time(){return this.playing?Math.max(0,this.offset+this.ctx.currentTime-this.anchor):this.offset;}
  index(){return (this.plan.findLast(p=>p.start<=this.time()+.001)||this.plan[0])?.index||0;}
  setQueue(tracks,tempo=this.tempo){this.pause();this.tempo=tempo;this.tracks=tracks;this.plan=makeStreamPlan(tracks,tempo);this.offset=0;this.buffers.clear();this.onchange();}
  async decode(track){
    if(this.buffers.has(track.id))return this.buffers.get(track.id);
    if(this.pending.has(track.id))return this.pending.get(track.id);
    const task=(async()=>{const data=await this.load(track);let buffer;try{buffer=await this.context().decodeAudioData(data);}catch{throw Error('This track could not be decoded. Try another song or check the PC server log.');}this.buffers.set(track.id,buffer);return buffer;})();
    this.pending.set(track.id,task);try{return await task;}finally{this.pending.delete(track.id);}
  }
  pause(){this.offset=this.time();this.playing=false;this.epoch++;clearInterval(this.timer);for(const v of this.voices.values()){try{v.source.stop();}catch{}v.source.disconnect();v.gain.disconnect();}this.voices.clear();this.wake?.release().catch(()=>{});this.wake=null;this.onchange();}
  clear(){this.pause();this.buffers.clear();this.plan=[];this.tracks=[];this.offset=0;this.onchange();}
  schedule(item,buffer,time){
    if(this.voices.has(item.index)||item.end<=time)return;
    const ctx=this.context(),start=Math.max(time,item.start),when=this.anchor+start-this.offset;
    const sourceTime=Math.max(0,item.source(start-item.start));if(sourceTime>=buffer.duration)return;
    const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=buffer;source.connect(gain);gain.connect(this.master);
    const marker=item.gs.findLast(g=>g.time<=sourceTime)||item.gs[0];
    source.playbackRate.setValueAtTime(item.synced?this.tempo/marker.bpm:1,when);
    if(item.synced)for(const m of item.gs)if(m.time>sourceTime&&m.time<item.outro)source.playbackRate.setValueAtTime(this.tempo/m.bpm,this.anchor+item.start+item.local(m.time)-this.offset);
    // Equal-power envelopes, including the correct gain when seeking into a mix.
    const initial=gainAt(item,start);
    const ramp=(from,to)=>{from=Math.max(from,start);if(to<=from)return;const curve=Float32Array.from({length:128},(_,i)=>gainAt(item,from+(to-from)*i/127));gain.gain.setValueCurveAtTime(curve,this.anchor+from-this.offset,to-from);};
    if(item.fadeIn&&start<item.start+item.fadeIn)ramp(item.start,item.start+item.fadeIn);
    else if(!(item.fadeOut&&start>=item.end-item.fadeOut))gain.gain.setValueAtTime(initial,when);
    ramp(item.end-item.fadeOut,item.end);
    source.start(when,sourceTime);source.stop(this.anchor+item.end-this.offset);
    this.voices.set(item.index,{source,gain});source.onended=()=>{if(this.voices.get(item.index)?.source===source){this.voices.delete(item.index);source.disconnect();gain.disconnect();}};
  }
  async play(){
    if(this.loading||this.playing||!this.plan.length)return;
    this.loading=true;const token=++this.epoch;this.onchange();
    try{
      try{if(navigator.audioSession)navigator.audioSession.type='playback';}catch{}
      await this.context().resume();if(this.offset>=this.plan.at(-1).end)this.offset=0;
      let active=this.plan.filter(p=>p.start<=this.offset+.001&&p.end>this.offset);
      await Promise.all(active.map(p=>this.decode(p.track)));if(token!==this.epoch)return;
      // Prefer the decoded duration over rounded XML TotalTime on first playback.
      const index=this.index(),local=this.offset-this.plan[index].start;let changed=false;
      for(const p of active){const actual=this.buffers.get(p.track.id).duration;if(Math.abs(actual-p.track.duration)>.05){p.track.duration=actual;changed=true;}}
      if(changed){this.plan=makeStreamPlan(this.tracks,this.tempo);this.offset=this.plan[index].start+local;active=this.plan.filter(p=>p.start<=this.offset+.001&&p.end>this.offset);}
      this.anchor=this.ctx.currentTime+.08;this.playing=true;
      active.forEach(p=>this.schedule(p,this.buffers.get(p.track.id),this.offset));
      this.timer=setInterval(()=>this.tick().catch(e=>this.fail(e)),250);this.tick().catch(e=>this.fail(e));
      if('wakeLock'in navigator)navigator.wakeLock.request('screen').then(w=>{if(this.playing)this.wake=w;else w.release();}).catch(()=>{});
    }catch(e){if(token===this.epoch)this.fail(e);}finally{this.loading=false;this.onchange();}
  }
  fail(e){this.pause();this.onerror(e);}
  async tick(){
    if(!this.playing||this.ticking)return;this.ticking=true;const token=this.epoch;
    try{
      const time=this.time();if(time>=this.plan.at(-1).end){this.pause();this.offset=this.plan.at(-1).end;this.onchange();return;}
      const i=this.index(),active=this.plan.filter(p=>p.start<=time&&p.end>time);
      const needed=active.length>1?active:this.plan.slice(i,i+2);
      for(const item of needed){const b=await this.decode(item.track);if(token!==this.epoch)return;this.schedule(item,b,this.time());}
      const allowed=new Set(needed.map(p=>p.track.id));for(const id of this.buffers.keys())if(!allowed.has(id))this.buffers.delete(id);
    }finally{this.ticking=false;}
  }
  async seek(time,autoplay=this.playing){this.pause();this.offset=Math.max(0,Math.min(this.plan.at(-1)?.end||0,time));this.onchange();if(autoplay)await this.play();}
  setVolume(value){this.volume=value;if(this.master)this.master.gain.setTargetAtTime(value,this.ctx.currentTime,.02);}
}
