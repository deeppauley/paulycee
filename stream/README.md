# Stream Room

Public portal at `https://paulycee.com/stream/`, backed by a server on the owner's Windows PC. No tracks or XML exports are committed to Git. `connection.json` supplies the public HTTPS endpoint; visitors connect automatically without a key. The catalog and audio are public while the PC server is running.

## Start

Requires Python 3.11+, FFmpeg/ffprobe on PATH, and cloudflared. No third-party Python package is required for the server; `qrcode` optionally generates a private phone QR.

```
python stream/manage.py start --xml "C:\Users\paule\Desktop\fullRBexport.xml" --state "C:\Users\paule\Desktop\Pauly Cee Stream Server" --public
```

The manager starts hidden processes bound to localhost plus an outbound HTTPS Quick Tunnel. Public mode requires no credentials. Generated connection shortcuts include only the endpoint address. CORS permits paulycee.com and local development on port 4187. Only track IDs listed in the XML are served; there are no directory listings or arbitrary file paths. The optional server private mode remains available when launched without `--public`, but the public website does not display a key field.

Press **Refresh library** after replacing the configured XML. Export via Rekordbox **File → Export Collection in xml format** to include the collection and playlist hierarchy. Existing files remain in their original locations; missing local files are displayed but skipped in playback queues. Tracks available only through third-party streaming subscriptions have no local audio to serve.

## Playback

Select a playlist or the full collection, search, and start a track. The queued order follows the playlist; search filters displayed results without changing playback order. Hearts save one global favorites list in `favorites.sqlite3` in the PC runtime folder. The list survives server restarts and is shared by all devices. Favorites view includes the entire collection regardless of the selected playlist. Changes appear in other open browsers on focus or within 15 seconds. Existing browser-local favorites are merged into the server list once and removed from localStorage only after a successful save. Public visitors share the same editable list; no account or key is required. Back up the runtime database with the rest of the PC's data.

The mixer uses the first playable track's BPM as the session tempo (editable). It aligns the first full downbeat of each track and the last complete bar of its outro, overlapping the final 32 complete beats with the next track's first 32 beats using equal-power fades. Two native audio elements stream with browser buffering, routed through Web Audio gains; no full-track PCM decoding or in-memory audio buffers are used. The media playheads are aligned to a shared beat clock, with gain automation on the AudioContext clock. Media startup timing is browser-dependent, so this is a rehearsal mixer rather than sample-accurate DJ software. Tempo markers are followed, including changes within tracks. This is varispeed, so pitch changes with speed. Short clips use a shorter overlap, and missing grids fall back to natural-speed timed crossfades. Failed preloads are isolated from current playback. Keep the page open for reliable mixing; mobile screen-lock behavior is not guaranteed.

MP3/M4A/AAC are served directly with HTTP byte ranges. WAV and other formats transcode to stereo AAC on demand in the runtime folder, never the repo, to avoid transferring huge lossless originals. The PC must stay awake with its source drives connected. Upload speed limits remote playback; the next track is buffered ahead of the overlap. Codec support depends on the browser. Incompatible M4A codecs may need manual conversion.

## Favorites ordering and transition correction

Favorites default to ascending BPM. BPM range and normalized Camelot-key filters, and ascending/descending BPM/key sorting, define the automix queue as well as the displayed list. Unknown BPM/key sort last. Changing these controls stops playback; press Play to start the new queue. Text search only narrows the displayed rows.

The PC analyzes low-frequency onset timing independently in the first and last 64 seconds, with the XML BPM as a constrained prior. Independent head/tail BPM agreement allows a conservative BPM refinement. FFmpeg `atempo` then prepares a constant-tempo, pitch-preserving AAC stream. The rendered audio is measured again for intro/outro alignment, keeping the XML bar position as a phrase prior. High-confidence results permit 32 beats; weak or inconsistent results choose 8 beats with bass handover. This is an automatic heuristic, not guaranteed recovery of arbitrary live drums, breakbeats, silent intros, or incorrect half/double BPM metadata.

The browser always plays prepared audio at rate 1, follows the audible outgoing media transport and no longer chases drift or variable XML tempo markers with continuous speed changes. Manual nudges have been removed. First playback at a new mix tempo takes extra preparation time. The next track prepares ahead of its transition; cache hits bypass the render lock so existing streams are not blocked. Analysis and rendered audio live in `mix-cache` under the external state directory, keyed by source path/mtime/size, algorithm version and requested tempo. No music is uploaded to Git. Global favorites remain unchanged on the PC server. Requires NumPy plus FFmpeg/ffprobe on the PC; tests cover shifted synthetic kicks, pitch preservation, cache reuse and browser rate stability. An actual iPhone listening test is still required for device-specific validation.

## Stop and restart

To restart **only** the audio backend without changing the tunnel address, run `stream/Restart Audio Backend.ps1` locally. It verifies the recorded server identity before stopping it, starts the updated backend hidden, and leaves the tunnel process running.

Audio preparation uses FFmpeg Rubber Band with stereo-linked channels and smoothing, or bypasses stretching for matching tempos. Versioned caches invalidate earlier `atempo` renders. The client buffers up to 3 seconds before starting and debounces transient `waiting` events to avoid immediate pause/reseek loops.

```
python stream/manage.py status --state "C:\Users\paule\Desktop\Pauly Cee Stream Server"
python stream/manage.py stop --state "C:\Users\paule\Desktop\Pauly Cee Stream Server"
```

Run **Restart Stream Server.ps1** from the runtime folder to restart. A Quick Tunnel gets a different address after restart. Update the site's `stream/connection.json` and deploy it to keep the plain `/stream/` URL working, or use the generated shortcut's `#server=` override immediately. No system startup task or power settings are changed. A permanent hostname requires a named tunnel account setup later.

The backend and manager are source utilities and are not launched by GitHub Pages. Public site deployment includes only app code in `stream/`; runtime metadata and audio stay outside the checkout. Existing `/practice/` content is a separate earlier library and is not used by Stream Room.
