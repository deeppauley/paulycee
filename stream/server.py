"""Private PC audio server. Only XML-listed track IDs are served; no directory access."""
import argparse,hashlib,hmac,json,mimetypes,os,pathlib,re,secrets,subprocess,threading,urllib.parse,xml.etree.ElementTree as ET
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler

def library(xml):
    root=ET.parse(xml).getroot();tracks=[];paths={}
    for t in root.find('COLLECTION').findall('TRACK'):
        location=urllib.parse.unquote(t.get('Location','')).removeprefix('file://localhost/')
        path=pathlib.Path(location);id=t.get('TrackID');paths[id]=path
        grids=[{'time':float(g.get('Inizio','0')),'bpm':float(g.get('Bpm','0')),'beat':int(g.get('Battito','1'))} for g in t.findall('TEMPO')]
        intro=next((g['time']+((1-g['beat'])%4)*60/g['bpm'] for g in grids if g['bpm']>0),0)
        tracks.append({'id':id,'name':t.get('Name') or path.stem,'artist':t.get('Artist',''),'bpm':float(t.get('AverageBpm') or 0),'key':t.get('Tonality',''),'duration':float(t.get('TotalTime') or 0),'intro':intro,'grids':grids,'available':path.is_file()})
    playlists=[]
    def walk(node,parents=[]):
        name=node.get('Name','');chain=parents+([name] if name!='ROOT' else [])
        if node.get('Type')=='1':playlists.append({'id':str(len(playlists)),'name':' / '.join(chain),'tracks':[t.get('Key') for t in node.findall('TRACK') if t.get('Key') in paths]})
        for child in node.findall('NODE'):walk(child,chain)
    for node in root.findall('PLAYLISTS/NODE'):walk(node)
    return {'name':pathlib.Path(xml).stem,'tracks':tracks,'playlists':playlists},paths

def main():
    p=argparse.ArgumentParser();p.add_argument('--xml',required=True);p.add_argument('--preferred-xml');p.add_argument('--state',required=True);p.add_argument('--port',type=int,default=4190);a=p.parse_args()
    def current_xml():return a.preferred_xml if a.preferred_xml and pathlib.Path(a.preferred_xml).is_file() else a.xml
    state=pathlib.Path(a.state);state.mkdir(parents=True,exist_ok=True);cache=state/'audio-cache';cache.mkdir(exist_ok=True)
    keyfile=state/'access-key.txt'
    if not keyfile.exists():keyfile.write_text(secrets.token_urlsafe(32))
    key=keyfile.read_text().strip();catalog,paths=library(current_xml());lock=threading.Lock();semaphore=threading.BoundedSemaphore(2)
    origins={'https://paulycee.com','https://www.paulycee.com','http://127.0.0.1:4187','http://localhost:4187'}
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass # Never log access headers or audio requests.
        def end_headers(self):
            origin=self.headers.get('Origin','')
            if origin in origins:self.send_header('Access-Control-Allow-Origin',origin)
            self.send_header('Vary','Origin');self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Referrer-Policy','no-referrer');super().end_headers()
        def do_OPTIONS(self):
            if self.headers.get('Origin','') not in origins:self.send_error(403);return
            self.send_response(204);self.send_header('Access-Control-Allow-Headers','Authorization,Range');self.send_header('Access-Control-Allow-Methods','GET,HEAD,OPTIONS');self.end_headers()
        def do_HEAD(self):self.handle_request(True)
        def do_GET(self):self.handle_request(False)
        def handle_request(self,head):
            if self.headers.get('Origin') and self.headers['Origin'] not in origins:self.send_error(403);return
            if not hmac.compare_digest(self.headers.get('Authorization','').encode(),'Bearer '.encode()+key.encode()):self.send_error(401,'Access key required');return
            route=urllib.parse.urlsplit(self.path).path
            if route=='/library':
                try:
                    with lock:
                        nonlocal catalog,paths
                        catalog,paths=library(current_xml());data=json.dumps(catalog).encode()
                    self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers()
                    if not head:self.wfile.write(data)
                except Exception:self.send_error(503,'Cannot read Rekordbox XML')
                return
            match=re.fullmatch(r'/audio/(\d+)',route)
            if not match or match[1] not in paths:self.send_error(404);return
            source=paths[match[1]]
            if not source.is_file():self.send_error(404,'Source file is unavailable on the PC');return
            try:
                stat=source.stat();fingerprint=hashlib.sha256((str(source)+str(stat.st_mtime_ns)+str(stat.st_size)).encode()).hexdigest()
                # MP3/M4A/WAV are served directly. Other formats become AAC on demand,
                # cached outside the repository; nothing is uploaded to GitHub.
                file=source;mime=mimetypes.guess_type(source.name)[0] or 'application/octet-stream'
                if source.suffix.lower() not in {'.mp3','.m4a','.wav','.aac'}:
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
    print(f'PC stream server on 127.0.0.1:{a.port}; {len(catalog["tracks"])} tracks, {sum(t["available"] for t in catalog["tracks"])} available. Access key saved outside repo.',flush=True)
    ThreadingHTTPServer(('127.0.0.1',a.port),Handler).serve_forever()

if __name__=='__main__':main()
