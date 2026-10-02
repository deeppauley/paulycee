# Practice Room

Playlist rehearsal at `/practice/`. The page is unlinked from the homepage and marked `noindex`, but **it is not private or authenticated**. Hosted audio and metadata are unencrypted and accessible to anyone with their URLs. Publish only audio you have permission to host publicly. No analytics or third-party scripts are loaded here.

## Listen

Open `/practice/` and press Play; no key is required. Old unlock bookmarks still open the player and their obsolete key fragment is removed. `library/library.json` defines the playlist order and metadata; `.m4a` files contain browser-compatible AAC audio. The updated Thai Festival playlist contains 77 entries. Existing track IDs were retained where possible so device-local transition edits remain associated with the same songs.

**Background listening:** native audio plays complete tracks at original speed, sequentially, without beat matching, overlaps or cue trims. On iPhone, open in Safari, tap Play, then lock the screen. Media Session supplies titles, play/pause, skip and seeking actions; the controls shown depend on iOS. The next compressed track is preloaded; old Blob URLs are released. iPhone/iPad default to this mode. Real-device screen-lock handoffs still need testing on your phone. Calls, closing the tab, other audio and OS memory pressure can interrupt playback.

**Mix practice:** Web Audio schedules beat-matched overlaps. Select a track and use Preview transition, or edit its intro/outro. Overlap choices are 0, 4, 8, 16 or 32 bars, capped for short songs. Beat sync is varispeed (pitch follows speed), not pitch-preserving key lock. Tracks without a grid play at original speed. Grid alignment does not guarantee compatible phrasing or vocals. This foreground mode requests screen wake lock where supported.

## Imports, offline listening and publishing

Audio imports remain in this browser's IndexedDB until explicitly published. XML imports match metadata by filename; M3U8 imports order device-local files. MP3/AAC are the safest formats across browsers. Hosted files cache while listening; **Save hosted tracks on this device** downloads the full library. The service worker caches the player shell, and the manifest is saved locally for offline loading. Browser quotas and eviction still apply.

To publish imported files, expand **Publish imported tracks for my other devices** and supply an owner GitHub token scoped to `deeppauley/paulycee` with Contents read/write. The upload is unencrypted. The token is never stored. Files must be under 70 MB. Publishing verifies the loaded manifest version, preserves the existing Git tree and never force-pushes. Reload after deployment. The publishing API is tested with mocks, not a live token.

## Migration and verification

`tools/update_plain_library.py` is the one-time encrypted-to-plain migration utility. It compares the updated M3U8 to the original playlist, decrypts reusable AAC files locally, and transcodes only new tracks. It requires the old encrypted library, its external key, the original playlist and Rekordbox XML. Source paths and keys are not written to the published manifest. Encrypted originals are removed from the current deployment after verification, but remain in Git history. Old encrypted browser caches may remain on previously used devices until site data is cleared.

Tests: `node practice/tools/test_mix.mjs`, `node practice/tools/test_publish.mjs`, `python practice/tools/test_plain.py --playlist <updated.m3u8>`, and `python practice/tools/test_background.py`. Browser tests use Playwright/Edge and default to a local server on port 4187; `--url` can target the deployed player. They verify playlist order, all AAC durations, audible mixing, transition overlap, native playback, auto-advance, offline loading and mobile width. They do not simulate physical iPhone lock-screen behavior. Older encrypted-library utilities/tests are retained for history and are not the current public-library workflow.
