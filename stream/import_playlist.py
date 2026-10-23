"""Register an ordered M3U playlist in the PC runtime; never copy music to Git."""
import argparse,json,os,pathlib
from server import library

def import_playlist(source,xml,state,slug,name):
    catalog,paths=library(xml)
    lookup={os.path.normpath(str(path.absolute())).casefold():id for id,path in paths.items()}
    source=pathlib.Path(source)
    entries=[line.strip() for line in source.read_text(encoding='utf-8-sig').splitlines() if line.strip() and not line.startswith('#')]
    ids=[]
    for entry in entries:
        path=pathlib.Path(entry)
        if not path.is_absolute():path=source.parent/path
        id=lookup.get(os.path.normpath(str(path.absolute())).casefold())
        if id is None or not path.is_file():raise ValueError('Missing library entry or file: '+str(path))
        ids.append(id)
    folder=pathlib.Path(state)/'playlists';folder.mkdir(parents=True,exist_ok=True)
    target=folder/(slug+'.json')
    if target.exists():raise FileExistsError(target)
    target.write_text(json.dumps({'name':name,'tracks':ids},indent=2),encoding='utf-8')
    print(f'Registered {len(ids)} tracks in exact playlist order: import-{slug}')
    return ids

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('--xml',required=True);p.add_argument('--state',required=True);p.add_argument('--slug',required=True);p.add_argument('--name',required=True)
    a=p.parse_args();import_playlist(a.source,a.xml,a.state,a.slug,a.name)
