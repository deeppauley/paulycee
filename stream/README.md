# Stream Room

Static portal at `https://paulycee.com/stream/`, backed by a server on the owner's Windows PC. No tracks, XML exports, connection keys or private library metadata are committed to Git. The site fetches the catalog and audio only from the PC server after connecting with a private key.

## Start

Requires Python 3.11+, FFmpeg/ffprobe on PATH, and cloudflared. No third-party Python package is required for the server; `qrcode` optionally generates a private phone QR.

```
python stream/manage.py start --xml "C:\Users\paule\Documents\Rekordbox Inbox.xml" --preferred-xml "C:\Users\paule\Documents\Rekordbox Full Library.xml" --state "C:\Users\paule\Desktop\Pauly Cee Stream Server"
```

The manager starts hidden processes bound to localhost plus an outbound HTTPS Quick Tunnel. Open **Open Stream Room.url** or scan **Private phone QR.png** from the private runtime folder. Keep these files private: the link contains the server's access key. The website removes the fragment after reading it and retains the connection only for the current browser session. Audio and library routes require Bearer authentication. CORS restricts browser callers to paulycee.com and local development on port 4187. No arbitrary paths or directory listings are served.

The preferred full XML takes over on the next **Refresh library** once the file exists. The original Inbox XML can be used as temporary test data. Export via Rekordbox **File → Export Collection in xml format** to include the collection and playlist hierarchy. Existing files remain in their original locations; missing local files are displayed but skipped in playback queues. Tracks available only through third-party streaming subscriptions have no local audio to serve.

## Playback

Select a playlist or the full collection, search, and start a track. The queued order follows the playlist; search filters displayed results without changing playback order. Hearts save favorites in localStorage on that browser. Favorites view filters the selected playlist; choose Full collection to browse all saved favorites. Favorites do not currently sync across devices.

The mixer uses the first playable track's BPM as the session tempo (editable). It aligns the first full downbeat of each track and the last complete bar of its outro, overlapping the final 32 complete beats with the next track's first 32 beats using equal-power fades. Tempo markers are followed, including changes within tracks. This is varispeed, so pitch changes with speed; it is not time-stretch key lock. Short clips use a shorter overlap, and missing grids fall back to natural-speed timed crossfades. The app buffers the current and next track in browser memory; audio is not stored for offline listening. Keep the page open for reliable mixing. Mobile screen-lock Web Audio behavior is not guaranteed.

MP3/M4A/WAV/AAC are served directly with HTTP byte ranges. Other formats transcode to stereo AAC on demand in the private runtime folder, never the repo. The PC must stay awake with its source drives connected. Upload speed limits remote playback; the next track is fetched ahead of the overlap. Codec support depends on the browser. Incompatible M4A codecs may need manual conversion.

## Stop and restart

```
python stream/manage.py status --state "C:\Users\paule\Desktop\Pauly Cee Stream Server"
python stream/manage.py stop --state "C:\Users\paule\Desktop\Pauly Cee Stream Server"
```

Run **Restart Stream Server.ps1** from the runtime folder to restart. A Quick Tunnel is temporary and gets a different address after restart. Open the newly generated private link on each device. No system startup task or power settings are changed. For a permanent hostname/reboot recovery, a named tunnel needs account setup later.

The backend and manager are source utilities and are not launched by GitHub Pages. Public site deployment includes only app code in `stream/`; runtime metadata and audio stay outside the checkout. Existing `/practice/` content is a separate earlier library and is not used by Stream Room.
