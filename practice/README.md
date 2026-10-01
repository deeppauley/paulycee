# Practice Room

Private practice player at `/practice/`. The main website has no link to it. Its HTML is marked `noindex`, but encryption, not the URL or indexing directive, protects the hosted music.

## Listen

Open the private unlock link saved separately in **Desktop / Pauly Cee Practice Access**, or open `/practice/` and paste the access key. The 256-bit key is never sent to the hosting server: link fragments stay in the browser and are removed immediately after reading. No analytics or third-party scripts are loaded on this page. Anyone who receives the key can decrypt the hosted library; keep it private. Lock clears the in-memory key and playback buffers.

Press Play for playlist-order playback. Select a track to edit its transition or press its play button to start there. Preview transition jumps to eight beats before the next overlap. Choose 0, 4, 8, 16, or 32 bars; short tracks cap overlap to a third of their duration. The waveforms and cue buttons seek within the set. Tempo/settings changes restart the current track. Pause resumes within an overlap.

Beat sync schedules audio on the Web Audio clock and follows Rekordbox tempo markers. **It uses varispeed: pitch changes with speed. It is not pitch-preserving key lock.** Key labels show source keys, not transposed keys. Tracks with no BPM/grid use natural-speed crossfades. Beat grids align rhythm; they cannot ensure good phrasing or compatible vocals. Listen and adjust intro/outro points to taste. Imported XML cues are available, but energy cue labels are not assumed to identify intro/outro boundaries.

## Device imports and mobile

Import audio files to store them privately in this browser's IndexedDB. Import Rekordbox XML to match metadata by unique filename. Import M3U8 after audio to restore playlist order. Browser imports are device-local, not cloud uploads. MP3/AAC are the safest browser formats; support for other codecs varies. Imported audio is not encrypted in local device storage.

Hosted audio caches as it plays. “Save hosted tracks on this device” downloads the whole encrypted library. Browser quotas and eviction still apply. The service worker caches the app shell for offline reopening; an access key is still required. Add to your phone's Home Screen for a standalone view. Test actual iOS/Android background playback before relying on it: mobile OS suspension can stop Web Audio. Screen wake lock is requested while playing where available.

## Publish a replacement private library

Requires Python, `cryptography`, and FFmpeg/ffprobe. Run `tools/package_library.py --playlist <playlist.m3u8> --xml <rekordbox.xml> --output practice/library --key-file <PRIVATE folder outside this repo>/library-key.txt` from the website root. This transcodes browser-compatible stereo AAC at 128 kbps, preserves the source timing, computes waveforms, and encrypts each file plus the metadata using AES-256-GCM with independent random IVs. Source filenames/paths are not published. Use this only for music you may privately rehearse.

The key is created if absent; preserve the same external key file when updating. Never commit a key, a private unlock link, or original music to the site. The current library is `library/library.bin` and numbered ciphertext files. Commit only ciphertext and player code, then deploy through the existing GitHub Pages workflow.

For uploads directly from the browser: unlock the hosted library, import audio and metadata, then expand **Publish imported tracks for my other devices**. Supply a fine-grained GitHub token scoped only to `deeppauley/paulycee` with Contents read/write. The app encrypts audio and metadata in the browser, writes Git blobs and a tree based on the current main commit, and fast-forwards main without force. It never uploads the library key or stores the token. MP3/AAC under 70 MB per file is recommended. This token is owner-level repository access; do not share it with listeners. If the branch changes during upload, publishing fails safely and can be retried after reloading. Pull main before subsequent desktop edits after browser publishing. The publish flow is tested with a mocked GitHub endpoint, not a real user's token.

## Verify

`node practice/tools/test_mix.mjs` tests grid conversion and transition mathematics. `tools/test_browser.py` uses Playwright/Edge, a local server, and an external key file to check decrypt/unlock, audio output, overlap, pause/resume, layout, and imports. Test images go outside the website repo. Neither test logs the key. These tests do not substitute for listening on your phone.
