import {keyCode} from './order.js';
export const audioKey=t=>t.audioId||t.id;
export function harmonicCompatibility(a,b){
  const x=keyCode(a),y=keyCode(b);if(!x||!y)return {score:.3,known:false,label:'Key unknown'};
  const n=parseInt(x),m=parseInt(y),same=x.at(-1)===y.at(-1),distance=Math.min(Math.abs(n-m),12-Math.abs(n-m));
  if(x===y)return {score:1,known:true,label:'Same key'};
  if(n===m)return {score:.95,known:true,label:'Relative major/minor'};
  if(same&&distance===1)return {score:.9,known:true,label:'Adjacent Camelot key'};
  return {score:.1,known:true,label:'Less compatible key'};
}
export function mixScore(a,b){
  const key=harmonicCompatibility(a.key,b.key),hasBpm=a.bpm>0&&b.bpm>0;
  const delta=hasBpm?Math.abs(a.bpm-b.bpm):null;
  const bpm=hasBpm?Math.exp(-delta/5):.25;
  const hasEnergy=Number.isFinite(a.energy)&&Number.isFinite(b.energy);
  const energy=hasEnergy?Math.max(0,1-Math.abs(a.energy-b.energy)*2):.4;
  return {score:.48*key.score+.37*bpm+.15*energy,key:key.label,delta,energyKnown:hasEnergy};
}
export function candidates(reference,tracks,limit=24){return tracks.map(track=>({track,...mixScore(reference,track)})).sort((a,b)=>b.score-a.score||a.track.name.localeCompare(b.track.name)).slice(0,limit);}
export function shuffled(tracks,random=Math.random){const out=[...tracks];for(let i=out.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[out[i],out[j]]=[out[j],out[i]];}return out;}
export function uniqueTracks(tracks){const keys=new Set();return tracks.filter(t=>{const key=audioKey(t);if(keys.has(key))return false;keys.add(key);return true;});}
export function eligible(tracks,{heard=new Set(),favorites=new Set(),avoidFavorites=false,current=null}={}){
  return uniqueTracks(tracks).filter(t=>t.available&&t.duration>0&&(t.id===current||(!heard.has(audioKey(t))&&(!avoidFavorites||!favorites.has(audioKey(t))))));
}
