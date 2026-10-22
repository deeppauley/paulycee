// Native single-deck playback: no AudioContext, tempo processing, fades or clock servo.
export function previewPlan(tracks){let start=0;return tracks.map((track,index)=>{const item={track,index,start,end:start+track.duration,duration:track.duration,intro:0,outro:track.duration,synced:false,fadeIn:0,fadeOut:0,source:t=>t,local:t=>t};start=item.end;return item;});}
export class PreviewPlayer{
  constructor({url,cue,onchange,onerror,onstarted=()=>{},canPlay=()=>true}){Object.assign(this,{url,cue,onchange,onerror,onstarted,canPlay});this.tracks=[];this.plan=[];this.cursor=0;this.offset=0;this.epoch=0;this.volume=.8;this.tempo=120;this.playing=false;this.loading=false;this.fresh=true;this.cues=new Map();}
  context(){
    if(!this.audio){
      const a=this.audio=new Audio();a.crossOrigin='anonymous';a.preload='auto';a.preservesPitch=true;a.playbackRate=1;a.defaultPlaybackRate=1;a.volume=this.volume;a.setAttribute('playsinline','');
      a.addEventListener('ended',()=>{if(!this.playing)return;if(this.plan[this.cursor+1])this.open(this.cursor+1,true);else{this.playing=false;this.fresh=true;this.offset=this.plan.at(-1)?.end||0;this.onchange();}});
      a.addEventListener('waiting',()=>{if(this.playing){this.loading=true;this.onchange();}});
      a.addEventListener('playing',()=>{this.loading=false;this.onchange();});
      a.addEventListener('error',()=>{if(this.playing){this.pause();this.onerror(Error('Original audio could not stream. Check the PC connection.'));}});
    }
    return this.audio;
  }
  index(){return this.cursor;}
  time(){const item=this.plan[this.cursor];return item&&this.loaded===item.track.id&&this.audio?.readyState?item.start+this.audio.currentTime:this.offset;}
  pause(){this.offset=this.time();this.epoch++;this.playing=false;this.loading=false;this.audio?.pause();this.onchange();}
  setQueue(tracks,tempo=120){this.pause();this.unload();this.resumeCurrent=false;this.tempo=tempo;this.tracks=tracks.map(t=>({...t._original||t}));this.plan=previewPlan(this.tracks);this.cursor=0;this.offset=0;this.fresh=true;this.onchange();}
  unload(){this.cancelLoad?.();if(this.audio){this.audio.removeAttribute('src');this.audio.load();}this.loaded=null;}
  clear(){this.pause();this.unload();this.tracks=[];this.plan=[];this.cursor=0;this.offset=0;this.onchange();}
  async load(item){
    const a=this.context();if(this.loaded===item.track.id&&a.readyState)return;
    this.cancelLoad?.();this.loaded=null;
    await new Promise((resolve,reject)=>{
      const clean=()=>{clearTimeout(timer);a.removeEventListener('loadedmetadata',ready);a.removeEventListener('error',fail);this.cancelLoad=null;};
      const ready=()=>{clean();this.loaded=item.track.id;resolve();};
      const fail=()=>{clean();reject(Error('This source audio could not be loaded.'));};
      const timer=setTimeout(fail,60000);this.cancelLoad=()=>{clean();reject(Error('Track changed.'));};
      a.addEventListener('loadedmetadata',ready);a.addEventListener('error',fail);a.src=this.url(item.track);a.load();
    });
  }
  async play(){
    if(this.playing||this.loading||!this.plan.length)return;
    if(this.fresh&&!this.resumeCurrent&&!this.canPlay(this.plan[this.cursor].track)){const next=this.plan.find(p=>p.index>this.cursor&&this.canPlay(p.track));if(next)return this.open(next.index,true);this.onerror(Error('No unheard eligible tracks remain. Reset session history to sample again.'));return;}
    const token=++this.epoch,item=this.plan[this.cursor];this.loading=true;this.onchange();
    try{
      try{if(navigator.audioSession)navigator.audioSession.type='playback';}catch{}
      const needCue=this.fresh;
      const analysis=needCue?(this.cues.has(item.track.id)?Promise.resolve(this.cues.get(item.track.id)):this.cue(item.track).catch(()=>({position:Math.min(60,item.duration*.25),method:'preview estimate'}))):Promise.resolve(null);
      const [data]=await Promise.all([analysis,this.load(item)]);if(token!==this.epoch)return;
      const a=this.audio;if(Number.isFinite(a.duration)&&a.duration>0){item.track.duration=a.duration;this.plan=previewPlan(this.tracks);}
      const current=this.plan[this.cursor];
      if(data){this.cues.set(item.track.id,data);current.previewMethod=data.method;this.offset=current.start+Math.max(0,Math.min(data.position,current.duration-.1));}
      a.playbackRate=1;a.defaultPlaybackRate=1;
      const position=Math.max(0,Math.min(this.offset-current.start,current.duration-.1));
      if(Math.abs(a.currentTime-position)>.05)a.currentTime=position;
      await a.play();if(token!==this.epoch){a.pause();return;}
      this.playing=true;this.fresh=false;
      this.resumeCurrent=false;this.onstarted(current.track);
    }catch(e){if(token===this.epoch){this.playing=false;this.onerror(e);}}
    finally{if(token===this.epoch){this.loading=false;this.onchange();}}
  }
  async open(index,autoplay=true,resumeCurrent=false){this.pause();this.cursor=Math.max(0,Math.min(index,this.plan.length-1));this.offset=this.plan[this.cursor]?.start||0;this.fresh=true;this.resumeCurrent=resumeCurrent;this.onchange();if(autoplay)await this.play();}
  async seek(time,autoplay=this.playing){this.pause();const item=this.plan.findLast(p=>p.start<=time)||this.plan[0];if(!item)return;this.cursor=item.index;this.offset=Math.max(item.start,Math.min(item.end-.01,time));this.fresh=false;if(this.loaded===item.track.id&&this.audio?.readyState)this.audio.currentTime=this.offset-item.start;this.onchange();if(autoplay)await this.play();}
  async jumpChorus(){await this.open(this.cursor,true,true);}
  replaceUpcoming(tracks){this.tracks=[...this.tracks.slice(0,this.cursor+1),...tracks.map(t=>({...t._original||t}))];this.plan=previewPlan(this.tracks);this.onchange();}
  setVolume(value){this.volume=value;if(this.audio)this.audio.volume=value;}
}
