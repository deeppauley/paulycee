import argparse, base64, json, pathlib
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
p=argparse.ArgumentParser();p.add_argument('--key-file',required=True);a=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[1];secret=pathlib.Path(a.key_file).read_text().strip();cipher=AESGCM(base64.urlsafe_b64decode(secret+'='))
def open_file(name):
    data=(root/'library'/name).read_bytes()
    return cipher.decrypt(data[:12],data[12:],None)
manifest=json.loads(open_file('library.bin'));tracks=manifest['tracks'];assert len(tracks)==80
for t in tracks:
    audio=open_file(t['file']);assert audio[4:8]==b'ftyp',t['id'];assert t['duration']>0
    assert 'Location' not in t and 'filename' not in t
for path in root.rglob('*'):
    if path.is_file() and path.suffix!='.bin':
        assert secret.encode() not in path.read_bytes(),'Access key found in website tree'
print(f'PASS: {len(tracks)} encrypted audio files authenticate and contain AAC containers; encrypted metadata parses; access key absent from website files.')
