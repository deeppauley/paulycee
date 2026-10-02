"""Update playlist order and export unencrypted AAC; reuse previously packaged tracks.

Dry-run by default. Source paths and access keys are never written to the website.
"""
import argparse,base64,hashlib,json,pathlib,subprocess,tempfile
from concurrent.futures import ThreadPoolExecutor
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from package_library import norm,run
import xml.etree.ElementTree as ET
import array

def entries(path):
    result=[];label=''
    for line in pathlib.Path(path).read_text(encoding='utf-8-sig').splitlines():
        line=line.strip()
        if line.startswith('#EXTINF:'):label=line.split(',',1)[1]
        elif line and not line.startswith('#'):
            result.append((line,label));label=''
    return result

def main():
    p=argparse.ArgumentParser()
    for arg in ['playlist','previous-playlist','xml','key-file','output']:p.add_argument('--'+arg,required=True)
    p.add_argument('--write',action='store_true');a=p.parse_args()
    out=pathlib.Path(a.output).resolve();key=base64.urlsafe_b64decode(pathlib.Path(a.key_file).read_text().strip()+'==')
    def decrypt(path):
        data=path.read_bytes();return AESGCM(key).decrypt(data[:12],data[12:],None)
    old=json.loads(decrypt(out/'library.bin'))['tracks'];previous=entries(a.previous_playlist)
    if len(previous)!=len(old):raise ValueError('Previous playlist does not match encrypted library count')
    bypath={norm(path):track for (path,_),track in zip(previous,old)}
    updated=entries(a.playlist);missing=[path for path,_ in updated if norm(path) not in bypath and not pathlib.Path(path).is_file()]
    reuse=sum(norm(path) in bypath for path,_ in updated)
    print(f'{len(updated)} playlist entries; {reuse} reusable AAC files; {len(updated)-reuse} new entries; {len(missing)} missing sources.',flush=True)
    for path in missing:print('Missing: '+path)
    if missing:raise SystemExit(1)
    if not a.write:return
    xml=ET.parse(a.xml).getroot().find('COLLECTION').findall('TRACK')
    metadata={norm(t.get('Location','')):t for t in xml}
    names={}
    for t in xml:names.setdefault(norm(t.get('Location','')).split('\\')[-1],[]).append(t)
    unique={norm(path):(path,label) for path,label in updated}
    def process(entry):
        source,label=entry;identity=norm(source);oldtrack=bypath.get(identity)
        filename='track-'+hashlib.sha256(identity.encode()).hexdigest()[:20]+'.m4a'
        if oldtrack:
            track=dict(oldtrack);audio=decrypt(out/oldtrack['file']);track['file']=filename
        else:
            t=metadata.get(identity)
            if t is None:
                candidates=names.get(identity.split('\\')[-1],[]);t=candidates[0] if len(candidates)==1 else None
            info=json.loads(run(['ffprobe','-v','error','-show_format','-of','json',source]))['format']
            tags={k.lower():v for k,v in info.get('tags',{}).items()}
            grids=[{'time':float(g.get('Inizio')),'bpm':float(g.get('Bpm')),'beat':int(g.get('Battito','1'))} for g in t.findall('TEMPO')] if t is not None else []
            cues=[{'name':c.get('Name') or 'Cue','time':float(c.get('Start')),'number':int(c.get('Num','-1')),'type':c.get('Type')} for c in t.findall('POSITION_MARK')] if t is not None else []
            with tempfile.TemporaryDirectory() as temp:
                encoded=pathlib.Path(temp)/'audio.m4a'
                run(['ffmpeg','-y','-v','error','-i',source,'-vn','-map_metadata','-1','-ac','2','-ar','44100','-c:a','aac','-b:a','128k','-movflags','+faststart',str(encoded)])
                audio=encoded.read_bytes()
            pcm=run(['ffmpeg','-v','error','-i',source,'-vn','-ac','1','-ar','1000','-f','s16le','-'])
            samples=array.array('h',pcm);stride=max(1,len(samples)//900)
            peaks=[round(max(abs(x) for x in samples[j:j+stride])/32768,3) for j in range(0,len(samples),stride)]
            track={'id':'track-'+hashlib.sha256(identity.encode()).hexdigest()[:20],'file':filename,'name':t.get('Name') if t is not None else tags.get('title',label or pathlib.Path(source).stem),'artist':t.get('Artist','') if t is not None else tags.get('artist',''),'duration':float(info['duration']),'bpm':float(t.get('AverageBpm') or 0) if t is not None else float(tags.get('tbpm',tags.get('bpm','0')) or 0),'key':t.get('Tonality','') if t is not None else tags.get('initialkey',''),'grids':grids,'cues':cues,'intro':next((g['time']+((1-g['beat'])%4)*60/g['bpm'] for g in grids if g['bpm']>0),0),'peaks':peaks,'metadata':'Rekordbox' if t is not None else 'File tags'}
        (out/filename).write_bytes(audio)
        # The playable AAC duration is authoritative; source container tags can be inaccurate.
        track['duration']=float(json.loads(run(['ffprobe','-v','error','-show_format','-of','json',str(out/filename)]))['format']['duration'])
        print(('Reused' if oldtrack else 'Encoded')+' '+filename,flush=True)
        return identity,track
    with ThreadPoolExecutor(max_workers=3) as pool:resolved=dict(pool.map(process,unique.values()))
    result=[];seen={}
    for path,_ in updated:
        track=dict(resolved[norm(path)]);n=seen.get(track['id'],0);seen[track['id']]=n+1
        if n:track['id']+=f'-repeat-{n}'
        result.append(track)
    (out/'library.json').write_text(json.dumps({'version':2,'encrypted':False,'name':pathlib.Path(a.playlist).stem,'tracks':result},ensure_ascii=False),encoding='utf-8')
    print(f'Wrote {len(result)} ordered tracks, {len(unique)} audio files. Encrypted originals retained until verification.',flush=True)

if __name__=='__main__':main()
