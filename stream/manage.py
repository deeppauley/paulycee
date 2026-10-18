"""Launch the PC server and an HTTPS tunnel; private runtime files stay outside Git.

python stream/manage.py start --xml <XML> --state <PRIVATE DIRECTORY>
python stream/manage.py stop --state <PRIVATE DIRECTORY>
"""
import argparse,json,os,pathlib,re,shutil,subprocess,sys,time,urllib.parse,urllib.request

def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['start','stop','status']);p.add_argument('--xml');p.add_argument('--preferred-xml');p.add_argument('--public',action='store_true');p.add_argument('--state',required=True);p.add_argument('--port',default=4190,type=int);a=p.parse_args()
    state=pathlib.Path(a.state).resolve();state.mkdir(parents=True,exist_ok=True);pidfile=state/'processes.json'
    processes=json.loads(pidfile.read_text()) if pidfile.exists() else {}
    if a.action=='status':
        print(json.dumps({'processes':processes,'private_link_exists':(state/'Open Stream Room.url').exists()}));return
    if a.action=='stop':
        for label,pid in processes.items():
            if not isinstance(pid,int):continue
            # Check command identity before stopping a potentially reused PID.
            result=subprocess.run(['powershell','-NoProfile','-Command',f'(Get-CimInstance Win32_Process -Filter "ProcessId={pid}").CommandLine'],capture_output=True,text=True)
            command=result.stdout.lower()
            if (label=='server' and 'server.py' in command and str(state).lower() in command) or (label=='tunnel' and 'cloudflared' in command and f'127.0.0.1:{a.port}' in command):
                subprocess.run(['taskkill','/PID',str(pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        pidfile.unlink(missing_ok=True);print('Stream server and its tunnel stopped.');return
    if processes:raise SystemExit('Runtime already recorded. Run status or stop before starting again.')
    if not a.xml or not pathlib.Path(a.xml).is_file():raise SystemExit('Supply an existing Rekordbox XML.')
    tunnel=shutil.which('cloudflared')
    if not tunnel:raise SystemExit('Install cloudflared before starting the HTTPS connection.')
    flags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0
    serverlog=(state/'server.log').open('ab');tunnellog=(state/'tunnel.log').open('wb')
    command=[sys.executable,'-u',str(pathlib.Path(__file__).with_name('server.py')),'--xml',str(pathlib.Path(a.xml).resolve()),'--state',str(state),'--port',str(a.port)]
    if a.preferred_xml:command+=['--preferred-xml',str(pathlib.Path(a.preferred_xml).resolve())]
    if a.public:command+=['--public']
    server=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=serverlog,stderr=serverlog,creationflags=flags)
    processes={'server':server.pid};pidfile.write_text(json.dumps(processes))
    try:
        for _ in range(60):
            if server.poll() is not None:raise RuntimeError('PC server exited. See server.log in the private runtime folder.')
            if a.public or (state/'access-key.txt').exists():
                key='' if a.public else (state/'access-key.txt').read_text().strip()
                try:
                    req=urllib.request.Request(f'http://127.0.0.1:{a.port}/library',headers={} if a.public else {'Authorization':'Bearer '+key})
                    with urllib.request.urlopen(req,timeout=3) as r:catalog=json.load(r)
                    break
                except Exception:pass
            time.sleep(.25)
        else:raise RuntimeError('PC server did not become ready.')
        cf=subprocess.Popen([tunnel,'tunnel','--url',f'http://127.0.0.1:{a.port}','--no-autoupdate','--protocol','http2'],stdin=subprocess.DEVNULL,stdout=tunnellog,stderr=tunnellog,creationflags=flags)
        processes['tunnel']=cf.pid;pidfile.write_text(json.dumps(processes))
        address=None
        for _ in range(240):
            if cf.poll() is not None:raise RuntimeError('HTTPS tunnel exited. See tunnel.log in the private runtime folder.')
            match=re.search(r'https://[a-z0-9-]+\.trycloudflare\.com',(state/'tunnel.log').read_text(errors='replace'))
            if match:address=match[0];break
            time.sleep(.25)
        if not address:raise RuntimeError('HTTPS connection timed out. See tunnel.log.')
        fragment=urllib.parse.urlencode({'server':address} if a.public else {'server':address,'key':key})
        link='https://paulycee.com/stream/#'+fragment
        (state/'Open Stream Room.url').write_text('[InternetShortcut]\nURL='+link+'\n')
        (state/'Private phone link.txt').write_text(link)
        (state/'connection.json').write_text(json.dumps({'server':address,'local':f'http://127.0.0.1:{a.port}'}))
        try:
            import qrcode
            qrcode.make(link).save(state/'Private phone QR.png')
        except ImportError:pass
        # Generated local shortcuts: credentials stay in the runtime folder.
        restart=f'& "{sys.executable}" "{pathlib.Path(__file__).resolve()}" stop --state "{state}"\n& "{sys.executable}" "{pathlib.Path(__file__).resolve()}" start --xml "{pathlib.Path(a.xml).resolve()}" --state "{state}"'
        if a.preferred_xml:restart+=f' --preferred-xml "{pathlib.Path(a.preferred_xml).resolve()}"'
        if a.public:restart+=' --public'
        (state/'Restart Stream Server.ps1').write_text(restart+'\n')
        print(json.dumps({'server':address,'tracks':len(catalog['tracks']),'available':sum(t['available'] for t in catalog['tracks']),'playlists':len(catalog['playlists']),'private_access_files':str(state),'processes':processes}),flush=True)
    except Exception:
        server.terminate()
        if 'cf' in locals():cf.terminate()
        pidfile.unlink(missing_ok=True);raise

if __name__=='__main__':main()
