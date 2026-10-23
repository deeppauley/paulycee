"""Private PC audio server. Only XML-listed track IDs are served; no directory access."""
import argparse,hashlib,hmac,json,mimetypes,os,pathlib,re,secrets,sqlite3,subprocess,threading,urllib.parse,xml.etree.ElementTree as ET
from contextlib import contextmanager,closing
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from beat_analysis import prepare as prepare_mix
from preview_analysis import preview as prepare_preview
from energy_analysis import energy as estimate_energy

def library(xml,playlist_dir=None):
    root=ET.parse(xml).getroot();tracks=[];paths={}
    for t in root.find('COLLECTION').findall('TRACK'):
        location=urllib.parse.unquote(t.get('Location','')).removeprefix('file://localhost/')
        path=pathlib.Path(location);id=t.get('TrackID');paths[id]=path
        grids=[{'time':float(g.get('Inizio','0')),'bpm':float(g.get('Bpm','0')),'beat':int(g.get('Battito','1'))} for g in t.findall('TEMPO')]
        intro=next((g['time']+((1-g['beat'])%4)*60/g['bpm'] for g in grids if g['bpm']>0),0)
        cues=[{'time':float(c.get('Start','0')),'name':c.get('Name','')} for c in t.findall('POSITION_MARK')]
        audio_id=hashlib.sha256(os.path.normpath(str(path.absolute())).casefold().encode()).hexdigest()[:24]
        tracks.append({'id':id,'audioId':audio_id,'name':t.get('Name') or path.stem,'artist':t.get('Artist',''),'bpm':float(t.get('AverageBpm') or 0),'key':t.get('Tonality',''),'duration':float(t.get('TotalTime') or 0),'intro':intro,'grids':grids,'cues':cues,'available':path.is_file()})
    playlists=[]
    def walk(node,parents=[]):
        name=node.get('Name','');chain=parents+([name] if name!='ROOT' else [])
        if node.get('Type')=='1':playlists.append({'id':str(len(playlists)),'name':' / '.join(chain),'tracks':[t.get('Key') for t in node.findall('TRACK') if t.get('Key') in paths]})
        for child in node.findall('NODE'):walk(child,chain)
    for node in root.findall('PLAYLISTS/NODE'):walk(node)
    if playlist_dir:
        for file in sorted(pathlib.Path(playlist_dir).glob('*.json')):
            imported=json.loads(file.read_text(encoding='utf-8-sig'))
            playlists.append({'id':'import-'+file.stem,'name':imported['name'],'tracks':[str(id) for id in imported['tracks'] if str(id) in paths],'rehearsal':True})
    return {'name':pathlib.Path(xml).stem,'tracks':tracks,'playlists':playlists},paths

def main():
    p=argparse.ArgumentParser();p.add_argument('--xml',required=True);p.add_argument('--preferred-xml');p.add_argument('--public',action='store_true');p.add_argument('--state',required=True);p.add_argument('--port',type=int,default=4190);a=p.parse_args()
    def current_xml():return a.preferred_xml if a.preferred_xml and pathlib.Path(a.preferred_xml).is_file() else a.xml
    state=pathlib.Path(a.state);state.mkdir(parents=True,exist_ok=True);cache=state/'audio-cache';cache.mkdir(exist_ok=True)
    keyfile=state/'access-key.txt'
    if not a.public and not keyfile.exists():keyfile.write_text(secrets.token_urlsafe(32))
    key=keyfile.read_text().strip() if not a.public else '';catalog,paths=library(current_xml(),state/'playlists');lock=threading.Lock();semaphore=threading.BoundedSemaphore(2)
    favorites_db=state/'favorites.sqlite3'
    @contextmanager
    def favorites_connection():
        with closing(sqlite3.connect(favorites_db,timeout=10)) as db:
            with db:yield db
    with favorites_connection() as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('CREATE TABLE IF NOT EXISTS favorites (track_id TEXT PRIMARY KEY)')
        db.execute('CREATE TABLE IF NOT EXISTS halloween_favorites (track_id TEXT PRIMARY KEY)')
        db.execute('CREATE TABLE IF NOT EXISTS transitions (from_id TEXT NOT NULL,to_id TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(from_id,to_id))')
    def favorite_ids(halloween=False):
        table='halloween_favorites' if halloween else 'favorites'
        with favorites_connection() as db:return [r[0] for r in db.execute(f'SELECT track_id FROM {table} ORDER BY track_id')]
    def transitions():
        with favorites_connection() as db:return {'pairs':[{'from':r[0],'to':r[1],'createdAt':r[2]} for r in db.execute('SELECT from_id,to_id,created_at FROM transitions ORDER BY created_at,from_id,to_id')]}
    origins={'https://paulycee.com','https://www.paulycee.com','http://127.0.0.1:4187','http://localhost:4187'}
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass # Never log access headers or audio requests.
        def end_headers(self):
            origin=self.headers.get('Origin','')
            if origin in origins:self.send_header('Access-Control-Allow-Origin',origin)
            self.send_header('Vary','Origin');self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Referrer-Policy','no-referrer');super().end_headers()
        def do_OPTIONS(self):
            if self.headers.get('Origin','') not in origins:self.send_error(403);return
            self.send_response(204);self.send_header('Access-Control-Allow-Headers','Authorization,Range,Content-Type');self.send_header('Access-Control-Allow-Methods','GET,HEAD,PUT,POST,OPTIONS');self.end_headers()
        def authorized(self):
            if self.headers.get('Origin') and self.headers['Origin'] not in origins:self.send_error(403);return False
            if not a.public and not hmac.compare_digest(self.headers.get('Authorization','').encode(),'Bearer '.encode()+key.encode()):self.send_error(401,'Access key required');return False
            return True
        def json_response(self,value,head=False):
            data=json.dumps(value).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers()
            if not head:self.wfile.write(data)
        def do_PUT(self):self.write_favorites()
        def do_POST(self):self.write_favorites()
        def write_favorites(self):
            if not self.authorized():return
            route=urllib.parse.urlsplit(self.path).path
            match=re.fullmatch(r'/favorites/(\d+)',route)
            halloween_match=re.fullmatch(r'/favorites/halloween/(\d+)',route)
            if halloween_match:match=halloween_match
            is_transition=self.command=='POST' and route=='/transitions'
            if not ((self.command=='PUT' and match) or (self.command=='POST' and route=='/favorites/import') or is_transition):self.send_error(404);return
            try:
                length=int(self.headers.get('Content-Length','0'))
                if length<=0 or length>262144 or not self.headers.get('Content-Type','').startswith('application/json'):self.send_error(400);return
                body=json.loads(self.rfile.read(length))
                if not isinstance(body,dict):raise ValueError()
                if is_transition:
                    first,second=body.get('from'),body.get('to')
                    if not isinstance(first,str) or not isinstance(second,str) or first==second:raise ValueError()
                    if first not in paths or second not in paths:self.send_error(404);return
                    if paths[first].resolve()==paths[second].resolve():raise ValueError()
                    with favorites_connection() as db:db.execute('INSERT OR IGNORE INTO transitions(from_id,to_id) VALUES (?,?)',(first,second))
                    self.json_response(transitions());return
                if match:
                    selected=body.get('favorite')
                    if type(selected) is not bool:raise ValueError()
                    if selected and match[1] not in paths:self.send_error(404);return
                    table='halloween_favorites' if halloween_match else 'favorites'
                    with favorites_connection() as db:
                        if selected:db.execute(f'INSERT OR IGNORE INTO {table}(track_id) VALUES (?)',(match[1],))
                        else:db.execute(f'DELETE FROM {table} WHERE track_id=?',(match[1],))
                else:
                    ids=body.get('ids')
                    if not isinstance(ids,list) or len(ids)>20000 or not all(isinstance(id,str) for id in ids):raise ValueError()
                    with favorites_connection() as db:db.executemany('INSERT OR IGNORE INTO favorites(track_id) VALUES (?)',[(id,) for id in set(ids) if id in paths])
                self.json_response({'ids':favorite_ids(bool(halloween_match))})
            except (ValueError,TypeError,json.JSONDecodeError):self.send_error(400,'Invalid favorites request')
            except sqlite3.Error:self.send_error(503,'Cannot save favorites on the PC')
        def do_HEAD(self):self.handle_request(True)
        def do_GET(self):self.handle_request(False)
        def handle_request(self,head):
            if not self.authorized():return
            route=urllib.parse.urlsplit(self.path).path
            if route=='/transitions':
                try:self.json_response(transitions(),head)
                except sqlite3.Error:self.send_error(503,'Cannot read saved transitions')
                return
            if route in {'/favorites','/favorites/halloween'}:
                try:self.json_response({'ids':favorite_ids(route.endswith('/halloween'))},head)
                except sqlite3.Error:self.send_error(503,'Cannot read favorites on the PC')
                return
            if route=='/library':
                try:
                    with lock:
                        nonlocal catalog,paths
                        catalog,paths=library(current_xml(),state/'playlists');data=json.dumps(catalog).encode()
                    self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers()
                    if not head:self.wfile.write(data)
                except Exception:self.send_error(503,'Cannot read Rekordbox XML')
                return
            energy_match=re.fullmatch(r'/energy/(\d+)',route)
            if energy_match:
                selected=energy_match[1]
                if selected not in paths or not paths[selected].is_file():self.send_error(404);return
                try:
                    track=next(t for t in catalog['tracks'] if t['id']==selected)
                    self.json_response(estimate_energy(paths[selected],track,state/'energy-cache'),head)
                except Exception:self.send_error(503,'Energy estimate failed')
                return
            preview_match=re.fullmatch(r'/preview/(\d+)',route)
            if preview_match:
                selected=preview_match[1]
                if selected not in paths or not paths[selected].is_file():self.send_error(404);return
                try:
                    track=next(t for t in catalog['tracks'] if t['id']==selected)
                    self.json_response(prepare_preview(paths[selected],track,state/'preview-cache'),head)
                except Exception:self.send_error(503,'Preview analysis failed')
                return
            prepared=re.fullmatch(r'/prepare/(\d+)',route)
            audio_match=re.fullmatch(r'/audio/(\d+)',route)
            mix_file=None
            if prepared or (audio_match and 'tempo' in urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)):
                selected=(prepared or audio_match)[1]
                if selected not in paths or not paths[selected].is_file():self.send_error(404);return
                try:
                    tempo=float(urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get('tempo',['120'])[0])
                    if not 60<=tempo<=180 or round(tempo,1)!=tempo:raise ValueError()
                except (ValueError,TypeError):self.send_error(400,'Invalid tempo');return
                try:
                    track=next(t for t in catalog['tracks'] if t['id']==selected)
                    result,mix_file=prepare_mix(paths[selected],track,tempo,state/'mix-cache')
                    if prepared:self.json_response(result,head);return
                except Exception:self.send_error(503,'Automatic mix preparation failed');return
            match=audio_match
            if not match or match[1] not in paths:self.send_error(404);return
            source=paths[match[1]]
            if not source.is_file():self.send_error(404,'Source file is unavailable on the PC');return
            try:
                stat=source.stat();fingerprint=hashlib.sha256((str(source)+str(stat.st_mtime_ns)+str(stat.st_size)).encode()).hexdigest()
                # MP3/M4A/WAV are served directly. Other formats become AAC on demand,
                # cached outside the repository; nothing is uploaded to GitHub.
                file=mix_file or source;mime='audio/mp4' if mix_file else mimetypes.guess_type(source.name)[0] or 'application/octet-stream'
                if not mix_file and source.suffix.lower() not in {'.mp3','.m4a','.aac'}:
                    file=cache/(fingerprint+'.m4a');mime='audio/mp4'
                    with semaphore:
                        if not file.exists():
                            temp=cache/(fingerprint+'-'+secrets.token_hex(4)+'.m4a')
                            try:
                                subprocess.run(['ffmpeg','-y','-v','error','-i',str(source),'-vn','-map_metadata','-1','-map_chapters','-1','-ac','2','-c:a','aac','-b:a','160k','-movflags','+faststart',str(temp)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=180)
                                os.replace(temp,file)
                            finally:temp.unlink(missing_ok=True)
                size=file.stat().st_size;start=0;end=size-1;range_header=self.headers.get('Range')
                if range_header:
                    m=re.fullmatch(r'bytes=(\d*)-(\d*)',range_header)
                    if not m or not any(m.groups()):self.send_error(416);return
                    if m[1]:start=int(m[1]);end=min(end,int(m[2])) if m[2] else end
                    else:start=max(0,size-int(m[2]))
                    if start>=size or end<start:
                        self.send_response(416);self.send_header('Content-Range',f'bytes */{size}');self.end_headers();return
                self.send_response(206 if range_header else 200);self.send_header('Content-Type',mime);self.send_header('Accept-Ranges','bytes');self.send_header('Content-Length',str(end-start+1))
                if range_header:self.send_header('Content-Range',f'bytes {start}-{end}/{size}')
                self.end_headers()
                if not head:
                    with file.open('rb') as f:
                        f.seek(start);remaining=end-start+1
                        while remaining:
                            chunk=f.read(min(262144,remaining))
                            if not chunk:break
                            self.wfile.write(chunk);remaining-=len(chunk)
            except (BrokenPipeError,ConnectionResetError):pass
            except Exception:self.send_error(503,'Audio preparation failed on the PC')
    print(f'PC stream server on 127.0.0.1:{a.port}; {len(catalog["tracks"])} tracks, {sum(t["available"] for t in catalog["tracks"])} available. Mode: {"public" if a.public else "private"}.',flush=True)
    ThreadingHTTPServer(('127.0.0.1',a.port),Handler).serve_forever()

if __name__=='__main__':main()
