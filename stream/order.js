const minor=['Ab','Eb','Bb','F','C','G','D','A','E','B','F#','C#'];
const major=['B','F#','C#','Ab','Eb','Bb','F','C','G','D','A','E'];
export function keyCode(value){
  const s=String(value||'').trim().replaceAll('♯','#').replaceAll('♭','b');
  const camel=/^(1[0-2]|[1-9])\s*([ab])$/i.exec(s);
  if(camel)return Number(camel[1])+camel[2].toUpperCase();
  const match=/^([A-Ga-g])([#b]?)(?:\s*(m|min|minor|maj|major))?$/.exec(s);
  if(!match)return '';
  let root=match[1].toUpperCase()+match[2];
  root=({'G#':'Ab','D#':'Eb','A#':'Bb','Db':'C#','Gb':'F#','Cb':'B','E#':'F','Fb':'E'})[root]||root;
  const index=(['m','min','minor'].includes(match[3])?minor:major).indexOf(root);
  return index<0?'':(index+1)+(['m','min','minor'].includes(match[3])?'A':'B');
}
export function favoriteOrder(tracks,{sort='bpm-asc',min='',max='',key=''}={}){
  const rank=t=>{const k=keyCode(t.key);return k?parseInt(k)*2+(k.endsWith('B')?1:0):Infinity;};
  const bpm=t=>Number(t.bpm)>0?Number(t.bpm):Infinity;
  const compare=(a,b,fn,desc)=>{const x=fn(a),y=fn(b);if(x===y)return 0;if(x===Infinity)return 1;if(y===Infinity)return -1;return (x-y)*(desc?-1:1);};
  return tracks.filter(t=>(min===''||t.bpm>0&&t.bpm>=Number(min))&&(max===''||t.bpm>0&&t.bpm<=Number(max))&&(!key||(key==='unknown'?!keyCode(t.key):keyCode(t.key)===key)))
    .sort((a,b)=>compare(a,b,sort.startsWith('key')?rank:bpm,sort.endsWith('desc'))||compare(a,b,bpm,false)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
}
