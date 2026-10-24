# Light-up wristband crowd signal

Local implementation only. Do not push/deploy until approved.

- Existing booth destination remains `/QR/`; its first link opens `/light-me-up/`.
- The new page reuses the established homepage HTML/CSS logo: Unbounded 900, tight tracking, and two dots above CEE. There is no standalone logo image in the workspace. This is the existing wordmark treatment, not a new logo design.
- Edit timing, giveaway item, and headline in `wristband/config.js`. Both pages derive timing/instructions from it. HTML contains readable fallback copy if modules cannot load; keep those fallbacks aligned when changing the event time.
- Early access stays open. No countdown, clock check, claim database, payment, social gate, or backend.
- Start requests fullscreen, wake lock, then landscape lock where available. Denied/absent APIs leave the display usable. Brightness is a manual instruction only. Exit restores the welcome screen; Back returns to QR links. Visibility and page lifecycle events release/reacquire wake lock as appropriate.
- CSS uses slow transform-based color fields, border-color animation, and a logo halo; the logo itself is stable. Reduced motion disables all animation.

## Validation

`npm run build` includes the root, QR and activation pages. The Vite config preserves classic root/QR scripts and QR link configuration in the output; existing classic-script bundling notices are expected. Deployment still uses the existing raw-static GitHub Pages workflow, which is unchanged.

`python wristband/test_glow.py` checks source and production output in headless Edge: QR links and CTA, route refresh, actual logo font load, 5 PM messaging, seven portrait/landscape viewport sizes (320×568 through 1024×768), no display overflow, denied/absent fullscreen/wake APIs, wake lifecycle, reduced motion, exit/focus/Escape and Back. Screenshots go outside Git into the PC runtime's `Wristband Preview` directory. Requires Python Playwright and Edge.

These are Chromium browser tests, not physical iPhone Safari/Android tests. Actual browser chrome, safe-area notches, fullscreen restrictions and screen-lock behavior require on-device checks. The wake lock is best-effort and the browser cannot set brightness.
