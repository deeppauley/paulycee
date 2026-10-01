"""Write private access shortcuts beside the key, never into the website."""
import argparse, pathlib
p=argparse.ArgumentParser();p.add_argument('--key-file',required=True);a=p.parse_args()
keyfile=pathlib.Path(a.key_file).resolve();root=pathlib.Path(__file__).resolve().parents[2]
if root in keyfile.parents:raise ValueError('Access files must be outside the repository')
key=keyfile.read_text().strip();url='https://paulycee.com/practice/#key='+key
(keyfile.parent/'Open Practice Room.url').write_text('[InternetShortcut]\nURL='+url+'\n')
(keyfile.parent/'Private phone link.txt').write_text('Open this link on your phone or computer. Anyone with it can listen; keep it private.\n\n'+url+'\n\nAccess key (for manual unlock):\n'+key+'\n')
print('Private shortcut and phone link written beside the key. No key printed.')
