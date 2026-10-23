"""Register an ordered M3U playlist in the PC runtime; never copy music to Git."""
import argparse,hashlib,json,os,pathlib,shutil,subprocess,time
from server import library

def import_playlist(source,xml,state,slug,name,replace=False):
    catalog,paths=library(xml)
    lookup={os.path.normpath(str(path.absolute())).casefold():id for id,path in paths.items()}
    source=pathlib.Path(source)
    entries=[line.strip() for line in source.read_text(encoding='utf-8-sig').splitlines() if line.strip() and not line.startswith('#')]
    ids=[];extra=[]
    for entry in entries:
        path=pathlib.Path(entry)
        if not path.is_absolute():path=source.parent/path
        id=lookup.get(os.path.normpath(str(path.absolute())).casefold())
        if not path.is_file():raise ValueError('Missing file: '+str(path))
        if id is None:
            fingerprint=hashlib.sha256(os.path.normpath(str(path.absolute())).casefold().encode()).hexdigest()
            id=str(10**15+int(fingerprint[:12],16))
            if id in paths:raise ValueError('Imported track ID collision')
            info=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration:format_tags','-of','json',str(path)],timeout=30))['format']
            tags={k.lower():v for k,v in info.get('tags',{}).items()}
            bpm=float(tags.get('tbpm',tags.get('bpm',0)))
            track={'id':id,'audioId':fingerprint[:24],'name':tags.get('title',path.stem),'artist':tags.get('artist',''),'bpm':bpm,'key':tags.get('tkey',tags.get('initialkey','')),'duration':float(info['duration']),'intro':0,'grids':[{'time':0,'bpm':bpm,'beat':1}] if bpm>0 else [],'cues':[]}
            extra.append({'path':str(path.absolute()),'track':track})
            lookup[os.path.normpath(str(path.absolute())).casefold()]=id
        ids.append(id)
    folder=pathlib.Path(state)/'playlists';folder.mkdir(parents=True,exist_ok=True)
    target=folder/(slug+'.json')
    if target.exists():
        if not replace:raise FileExistsError(target)
        backups=pathlib.Path(state)/'playlist-backups';backups.mkdir(exist_ok=True)
        shutil.copy2(target,backups/(slug+'-'+str(time.time_ns())+'.json'))
    temporary=target.with_suffix('.tmp')
    temporary.write_text(json.dumps({'name':name,'tracks':ids,'extraTracks':extra},indent=2),encoding='utf-8')
    os.replace(temporary,target)
    print(f'Registered {len(ids)} tracks in exact playlist order: import-{slug}')
    return ids

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('--xml',required=True);p.add_argument('--state',required=True);p.add_argument('--slug',required=True);p.add_argument('--name',required=True);p.add_argument('--replace',action='store_true')
    a=p.parse_args();import_playlist(a.source,a.xml,a.state,a.slug,a.name,a.replace)
