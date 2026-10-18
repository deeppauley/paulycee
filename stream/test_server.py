"""Isolated backend integration test; generated audio and XML stay in a temp folder."""
import json,math,pathlib,socket,struct,subprocess,sys,tempfile,time,urllib.request,urllib.error,wave
from xml.sax.saxutils import escape

def prepare(root):
    root=pathlib.Path(root);tracks=[]
    for i in range(2):
        file=root/f'tone-{i}.wav'
        with wave.open(str(file),'wb') as f:
            f.setnchannels(1);f.setsampwidth(2);f.setframerate(16000)
            one=b''.join(struct.pack('<h',int(6500*math.sin(2*math.pi*(220+i*110)*j/16000))) for j in range(16000));f.writeframes(one*60)
        location='file://localhost/'+str(file).replace('\\','/')
        tracks.append(f'<TRACK TrackID="{1001+i}" Name="Tone {i+1}" Artist="Test artist" AverageBpm="{120+i*8}" Tonality="8A" TotalTime="60" Location="{escape(location, {chr(34): "&quot;"})}"><TEMPO Inizio="0" Bpm="{120+i*8}" Battito="1"/></TRACK>')
    (root/'library.xml').write_text('<DJ_PLAYLISTS><COLLECTION>'+''.join(tracks)+'</COLLECTION><PLAYLISTS><NODE Name="ROOT" Type="0"><NODE Name="Folder" Type="0"><NODE Name="Test playlist" Type="1"><TRACK Key="1002"/><TRACK Key="1001"/></NODE></NODE></NODE></PLAYLISTS></DJ_PLAYLISTS>')
    return root/'library.xml'

def main():
    with tempfile.TemporaryDirectory() as temp:
        root=pathlib.Path(temp);xml=prepare(root);state=root/'state';sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
        process=subprocess.Popen([sys.executable,str(pathlib.Path(__file__).with_name('server.py')),'--xml',str(xml),'--state',str(state),'--port',str(port)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        base=f'http://127.0.0.1:{port}'
        try:
            for _ in range(100):
                if (state/'access-key.txt').exists():break
                time.sleep(.05)
            key=(state/'access-key.txt').read_text().strip()
            def get(path,headers={}):return urllib.request.urlopen(urllib.request.Request(base+path,headers={'Authorization':'Bearer '+key,**headers}),timeout=10)
            for _ in range(100):
                try:
                    with get('/library') as response:catalog=json.load(response)
                    break
                except OSError:time.sleep(.05)
            assert len(catalog['tracks'])==2;assert all(t['available'] for t in catalog['tracks']);assert catalog['playlists'][0]['tracks']==['1002','1001'];assert catalog['playlists'][0]['name']=='Folder / Test playlist'
            assert 'Location' not in json.dumps(catalog) and str(root) not in json.dumps(catalog)
            with get('/audio/1001',{'Range':'bytes=0-43','Origin':'https://paulycee.com'}) as response:
                assert response.status==206;assert response.read()[4:8]==b'ftyp';assert response.headers['Content-Length']=='44';assert response.headers['Access-Control-Allow-Origin']=='https://paulycee.com'
            with get('/audio/1001',{'Range':'bytes=-10'}) as response:assert len(response.read())==10
            cases=[('/library',{'Authorization':'Bearer incorrect'},401),('/library',{'Origin':'https://evil.example'},403),('/audio/../../access-key.txt',{},404),('/audio/9999',{},404),('/audio/1001',{'Range':'bytes=999999999-'},416)]
            for path,headers,code in cases:
                try:get(path,headers);raise AssertionError('Unexpected success')
                except urllib.error.HTTPError as e:assert e.code==code,(path,e.code)
            print('PASS: nested playlist order, no source paths, auth, CORS, byte ranges, suffix ranges, invalid ranges and path allowlist.')
        finally:process.terminate();process.wait(timeout=10)

if __name__=='__main__':main()
