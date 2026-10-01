"""Build an encrypted practice library. The access key MUST stay outside the website repo."""
import argparse, base64, json, os, pathlib, subprocess, tempfile, urllib.parse, xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

def run(args):
    return subprocess.check_output(args, stderr=subprocess.DEVNULL)

def norm(path):
    return urllib.parse.unquote(path).removeprefix('file://localhost/').replace('/', '\\').lower()

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--playlist', required=True)
    p.add_argument('--xml', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--key-file', required=True)
    a = p.parse_args()
    out = pathlib.Path(a.output).resolve()
    keyfile = pathlib.Path(a.key_file).resolve()
    if out in keyfile.parents:
        raise ValueError('Key must be outside the publish directory')
    out.mkdir(parents=True, exist_ok=True)
    keyfile.parent.mkdir(parents=True, exist_ok=True)
    key = base64.urlsafe_b64decode(keyfile.read_text().strip() + '==') if keyfile.exists() else AESGCM.generate_key(256)
    if not keyfile.exists():
        keyfile.write_text(base64.urlsafe_b64encode(key).decode().rstrip('='))
    tracks = ET.parse(a.xml).getroot().find('COLLECTION').findall('TRACK')
    bypath = {norm(t.get('Location', '')): t for t in tracks}
    byname = {}
    for t in tracks:
        name = norm(t.get('Location', '')).split('\\')[-1]
        byname.setdefault(name, []).append(t)
    playlist = []
    label = ''
    for line in pathlib.Path(a.playlist).read_text(encoding='utf-8-sig').splitlines():
        if line.startswith('#EXTINF:'):
            label = line.split(',', 1)[1]
        elif line and not line.startswith('#'):
            playlist.append((line, label))
            label = ''
    def seal(data):
        iv = os.urandom(12)
        return iv + AESGCM(key).encrypt(iv, data, None)
    def process(item):
        i, (path, label) = item
        t = bypath.get(norm(path))
        if t is None:
            candidates = byname.get(norm(path).split('\\')[-1], [])
            t = candidates[0] if len(candidates) == 1 else None
        info = json.loads(run(['ffprobe', '-v', 'error', '-show_format', '-of', 'json', path]))['format']
        tags = {k.lower(): v for k, v in info.get('tags', {}).items()}
        duration = float(info['duration'])
        grids = [{'time': float(g.get('Inizio')), 'bpm': float(g.get('Bpm')), 'beat': int(g.get('Battito', '1'))} for g in t.findall('TEMPO')] if t is not None else []
        cues = [{'name': c.get('Name') or ('Memory' if c.get('Num') == '-1' else 'Cue ' + str(int(c.get('Num', '0')) + 1)), 'time': float(c.get('Start')), 'number': int(c.get('Num', '-1')), 'type': c.get('Type')} for c in t.findall('POSITION_MARK')] if t is not None else []
        bpm = float(t.get('AverageBpm') or 0) if t is not None else float(tags.get('tbpm', tags.get('bpm', '0')) or 0)
        downbeat = next((g['time'] + ((1-g['beat']) % 4) * 60/g['bpm'] for g in grids if g['bpm'] > 0), 0)
        filename = f'{i:03d}.bin'
        with tempfile.TemporaryDirectory() as temp:
            encoded = pathlib.Path(temp) / 'audio.m4a'
            run(['ffmpeg', '-y', '-v', 'error', '-i', path, '-vn', '-map_metadata', '-1', '-ac', '2', '-ar', '44100', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', str(encoded)])
            (out / filename).write_bytes(seal(encoded.read_bytes()))
        pcm = run(['ffmpeg', '-v', 'error', '-i', path, '-vn', '-ac', '1', '-ar', '1000', '-f', 's16le', '-'])
        import array
        samples = array.array('h', pcm)
        stride = max(1, len(samples)//900)
        peaks = [round(max(abs(x) for x in samples[j:j+stride])/32768, 3) for j in range(0, len(samples), stride)]
        track = {'id': str(i), 'file': filename, 'name': t.get('Name') if t is not None else tags.get('title', label or pathlib.Path(path).stem), 'artist': t.get('Artist', '') if t is not None else tags.get('artist', ''), 'duration': duration, 'bpm': bpm, 'key': t.get('Tonality', '') if t is not None else tags.get('initialkey', ''), 'grids': grids, 'cues': cues, 'intro': downbeat, 'peaks': peaks, 'metadata': 'Rekordbox' if t is not None else 'File tags'}
        print(f'{i+1}/{len(playlist)} packaged; metadata={track["metadata"]}', flush=True)
        return track
    with ThreadPoolExecutor(max_workers=3) as pool:
        result = list(pool.map(process, enumerate(playlist)))
    manifest = {'version': 1, 'name': pathlib.Path(a.playlist).stem, 'tracks': result}
    (out / 'library.bin').write_bytes(seal(json.dumps(manifest, ensure_ascii=False).encode()))
    print(f'Completed {len(result)} tracks; {sum(t["metadata"]=="Rekordbox" for t in result)} matched Rekordbox. Key stored separately.', flush=True)

if __name__ == '__main__':
    main()
