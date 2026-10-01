// Beat positions are relative to each Rekordbox TEMPO marker, including tempo changes.
export function grid(track) {
  const list=(track.grids||[]).filter(g=>g.bpm>0).map(g=>({...g})).sort((a,b)=>a.time-b.time);
  if(!list.length && track.bpm>0) list.push({time:0,bpm:track.bpm,beat:1});
  if(!list.length) return [];
  list[0].beats=0;
  for(let i=1;i<list.length;i++) list[i].beats=list[i-1].beats+(list[i].time-list[i-1].time)*list[i-1].bpm/60;
  return list;
}
export function beatAt(gs,seconds){const g=gs.findLast(g=>g.time<=seconds)||gs[0];return g.beats+(seconds-g.time)*g.bpm/60;}
export function sourceAt(gs,beat){const g=gs.findLast(g=>g.beats<=beat)||gs[0];return g.time+(beat-g.beats)*60/g.bpm;}
export function makePlan(tracks,settings,overrides={}){
  const result=[];
  for(const t of tracks){
    const gs=grid(t), synced=settings.sync && gs.length>0;
    const custom=overrides[t.id]||{};
    const intro=Math.max(0,Math.min(t.duration-1,custom.intro??t.intro??0));
    // Snap the tail to a bar relative to the first downbeat, keeping all complete outro bars.
    let end=t.duration;
    if(synced){const origin=beatAt(gs,t.intro||0);end=sourceAt(gs,origin+Math.floor((beatAt(gs,end)-origin)/4)*4);}
    end=Math.max(intro+.5,Math.min(t.duration,custom.outro??end));
    const base=synced?beatAt(gs,intro):0;
    const duration=synced?(beatAt(gs,end)-base)*60/settings.tempo:end-intro;
    const prev=result.at(-1);
    const desired=settings.bars*4*60/settings.tempo;
    const overlap=prev?Math.floor(Math.min(desired,duration/3,prev.duration/3)/(240/settings.tempo))*(240/settings.tempo):0;
    const start=prev?prev.end-overlap:0;
    const item={track:t,gs,synced,intro,outro:end,base,duration,start,end:start+duration,fadeIn:overlap,fadeOut:0,index:result.length};
    if(prev)prev.fadeOut=overlap;
    item.source=local=>synced?sourceAt(gs,base+local*settings.tempo/60):intro+local;
    item.local=seconds=>synced?(beatAt(gs,seconds)-base)*60/settings.tempo:seconds-intro;
    result.push(item);
  }
  return result;
}
export function gainAt(item,time){const local=time-item.start;if(local<0||time>item.end)return 0;if(item.fadeIn>0 && local<item.fadeIn)return Math.sin(local/item.fadeIn*Math.PI/2);if(item.fadeOut>0 && time>item.end-item.fadeOut)return Math.cos((time-(item.end-item.fadeOut))/item.fadeOut*Math.PI/2);return 1;}
