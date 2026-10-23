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

## Ordered rehearsal playlists

`import_playlist.py` matches a UTF-8 M3U8 against the full Rekordbox export by source path and validates every file. Tracks missing from the export use embedded tags and duration from ffprobe, with stable numeric IDs. IDs and supplemental metadata/source paths live only in `playlists/<slug>.json` in the external PC state directory; public responses omit source paths. `--replace` backs up the prior manifest before atomic replacement. Neither music nor runtime manifests are added to Git. The backend includes these lists on library refresh, in their original order, pinned above Full collection in the menu. `?playlist=import-asian-beer-fest` opens the Asian Beer Fest rehearsal directly, selecting Automix, playlist order, and the first track's BPM.

Rehearsal playlists permit playback of previously heard tracks and Favorites regardless of sampling exclusions. History is still recorded, not erased; switching back to the collection or Favorites restores the existing exclusions. This allows full repeat rehearsals without resetting discovery history.

Automix offers 8 bars (32 beats) or 4 bars (16 beats), in 4/4 time. The selected length overrides the older confidence-based 8-beat fallback, but very short tracks still cap the overlap at half of either track. Changes restart the current track and retain its upcoming queue. PC-side Rubber Band preserves pitch while rendering to one steady session tempo; the browser plays the render at rate 1. Beat/phrase alignment remains heuristic and is not Rekordbox's proprietary engine. Existing session-history and optional Favorite exclusions still apply; Reset session history permits a full repeat rehearsal. First-time preparation can take longer, then uses the PC cache. Reliable screen-lock automixing on iPhone is not guaranteed.

## Fast Preview (default)

The playback-mode selector defaults to Fast Preview. It uses one native HTML audio element at rate 1, with no Web Audio routing, mix fades, tempo query, `/prepare` request or time stretching. MP3/M4A/AAC sources stream directly; other formats use the existing format-only AAC conversion. Automix remains available as an explicit option.

`/preview/<id>` chooses the earliest named chorus/hook/drop cue from the exported XML. Without a named cue it estimates a repeated energetic section in the first 180 seconds, and falls back to an approximate preview point when uncertain. UI copy labels the jump as an estimate rather than claiming semantic chorus recognition. Analysis is cached outside Git, keyed by source fingerprint, cues and algorithm version.

New tracks, Next/Previous, row Play and First chorus jump to that track's preview point. Scrubbing uses the entire original file, including time zero, and never automatically jumps the user back to the chorus. Tracks continue to their end before the next preview starts, without overlap. Pause/resume preserves the scrub position. Media Session seeking and next/previous use the same controls. Tests cover original-source requests (no tempo processing), one active deck, fixed playback rate, full-song scrubbing, named cues, estimated hooks, queue completion and mobile width. On-device iPhone listening remains a separate validation step.

## Discovery queues and saved transitions

Queue order applies to Full collection, every imported playlist, Favorites and the Good transitions view. Choose Playlist order, Fisher–Yates Shuffle, or Mixed in Key–style harmonic picks. The latter is an independent heuristic, not Mixed in Key software: it ranks same/relative/adjacent Camelot keys, absolute BPM distance, and (when measured) a short-sample loudness/onset energy proxy. Unknown metadata receives a conservative score. Only the current song and eight likely candidates request energy analysis; it does not scan the audio of the entire collection. New suggestions replace only the upcoming queue, not the audible track. Energy metadata is cached outside Git.

Successful playback marks the source file's opaque identity in `sessionStorage` for this website tab. Refresh, switching playlists or changing the PC tunnel address do not reset the current tab's sampling history; a new tab has its own session. Different XML references to the same file are deduplicated; separate files containing the same song are not audio-fingerprinted. Loads/preloads/analysis do not mark a track played. Next, Previous, row Play and automatic advance skip sampled songs; no wrap/repeat occurs on exhaustion. Scrubbing, resuming, changing playback mode/tempo for the current song and the explicit First chorus control remain within-track operations. Reset session history permits another sampling pass without modifying Favorites or saved pairs.

Skip global Favorites is optional and affects all queues, including the Favorites view itself. Favorite updates are polled and checked again before new audio starts; the currently audible song is allowed to finish. The setting and queue-order preference survive refresh in this tab.

Good transition saves the last two successfully started, distinct songs in order. Preview mode labels this as a preview pairing, not a beatmatched mix. The button remains available after the handoff until another pairing replaces it or the queue changes. `GET/POST /transitions` stores idempotent ordered pairs in a separate `transitions` table in the external runtime SQLite database; it does not add songs to Favorites. Good transitions is selectable as a deduplicated song playlist, with each intact A → B pair listed above the queue and its own Play pair button. Pair audition preserves A → B even with harmonic mode enabled. Repeat/Favorite exclusions still apply: reset history and/or disable Favorite skipping to replay a saved pair. Cross-browser pair updates refresh periodically; browser sampling history remains local to each tab.

## Halloween Party Favorites

The player has two independent, adjacent 112px heart buttons: the existing normal Favorites heart and Halloween Party. Either or both can be selected for a track. Normal liked hearts remain red; Halloween Party uses an orange-accented button with a red selected heart. Both named lists are available from the playlist selector and adjacent filter buttons, with independent counts and the existing BPM/key sort/filter controls. Shuffle, harmonic picks and session-repeat protection apply to both. Skip Favorites excludes the union of the two lists.

The normal `/favorites`, `/favorites/<id>` and legacy import endpoints are unchanged. `GET /favorites/halloween` and `PUT /favorites/halloween/<id>` use a separate `halloween_favorites` SQLite table in the external state database. Adding/removing either list never edits the other list. Both persist and refresh across browsers. New Halloween lists start empty; existing normal Favorites are not copied or altered.

## Stop and restart

To restart **only** the audio backend without changing the tunnel address, run `stream/Restart Audio Backend.ps1` locally. It verifies the recorded server identity before stopping it, starts the updated backend hidden, and leaves the tunnel process running.

Audio preparation uses FFmpeg Rubber Band with stereo-linked channels and smoothing, or bypasses stretching for matching tempos. Versioned caches invalidate earlier `atempo` renders. The client buffers up to 3 seconds before starting and debounces transient `waiting` events to avoid immediate pause/reseek loops.

```
python stream/manage.py status --state "C:\Users\paule\Desktop\Pauly Cee Stream Server"
python stream/manage.py stop --state "C:\Users\paule\Desktop\Pauly Cee Stream Server"
```

Run **Restart Stream Server.ps1** from the runtime folder to restart. A Quick Tunnel gets a different address after restart. Update the site's `stream/connection.json` and deploy it to keep the plain `/stream/` URL working, or use the generated shortcut's `#server=` override immediately. No system startup task or power settings are changed. A permanent hostname requires a named tunnel account setup later.

The backend and manager are source utilities and are not launched by GitHub Pages. Public site deployment includes only app code in `stream/`; runtime metadata and audio stay outside the checkout. Existing `/practice/` content is a separate earlier library and is not used by Stream Room.
