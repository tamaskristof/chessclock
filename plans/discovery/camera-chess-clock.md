# Discovery: Camera Chess Clock

## Idea
A chess clock with no electronics on the table. A wooden board rests on a wedge like a seesaw. A player ends their turn by pressing their side down. A phone on a stand watches the board with its back camera, works out which side is down, and runs the two clocks.

## Goals
- Works offline on Android and iOS phones and installs easily: open a URL, then "Add to Home screen".
- Detects the board state reliably with no stickers or markers.
- Low CPU and battery use during long games.
- Timing is fair: detection latency and debounce never cost a player any time.

## Non-goals (v1)
- Native or app-store builds. A Capacitor wrapper is possible later.
- Marker or sticker detection, and ML models.
- Delay and Bronstein time modes, game history, move counting.
- Backend, accounts, multiplayer sync.

## Decisions
| Topic | Decision |
|---|---|
| Platform | PWA (Vite + TypeScript, vanilla, no UI framework), `vite-plugin-pwa` for the service worker and manifest |
| Hosting | GitHub Pages, deployed by GitHub Actions on push to `main` (HTTPS is required for the camera) |
| Detection | Snapshot calibration: the user marks the board area (ROI) and captures "left down" and "right down" reference images |
| Time controls | Fixed time per player (presets plus custom) and Fischer increment |
| Alerts | Sound (Web Audio beep) and vibration (`navigator.vibrate`, Android only) when time runs low and when a flag falls |
| Ticketing | No Jira |

## Detection concept
1. **Camera:** `getUserMedia({ video: { facingMode: "environment", width: 320, height: 240, frameRate: 15 }, audio: false })`.
2. **ROI:** the user drags a rectangle over the board on the live preview. It is stored in normalised coordinates (0..1).
3. **Sampling:** throttle `requestVideoFrameCallback` to about 8 Hz, with a `setTimeout` fallback. Draw only the ROI into a 32×32 canvas, convert it to grayscale, and subtract the mean so that brightness changes don't matter.
4. **Calibration:** store the averaged 32×32 vectors `refLeft` and `refRight`, each taken over about 5 frames.
5. **Classification:** compute the distance from the current frame to each reference (mean absolute difference). The candidate is the closer reference. A frame counts as `unknown` if `min/max > 0.8` (too ambiguous, e.g. a hand covering the board).
6. **Hysteresis:** the state switches only after the same candidate wins 3 frames in a row. The switch timestamp is the capture time of the **first** of those frames, so the debounce costs nobody time.
7. **Motion gating:** if the difference from the previous frame is below a threshold, skip classification and keep the current state.

## Clock concept
- A pure state machine with states `idle | running | paused | flagged`. Player times are kept in ms. All time comes from `performance.now()` deltas.
- The board state maps to the side to move: board **left side down** means the left player has finished their move, so the **right** clock runs (the same as pressing a real clock button).
- Fischer increment is added to the player who just finished their move.
- A low-time warning plays once when a player drops below 10 s, and a flag alert plays at 0.

## Efficiency measures
- Low camera resolution and frame rate. Only about 1k pixels are processed per sample, on the main thread, so no worker is needed.
- Camera tracks are stopped when the game is paused, when it ends, and on `visibilitychange` to hidden.
- A "camera background" toggle hides the `<video>` element.
- The Screen Wake Lock is requested while running and released when paused.
- The UI is redrawn with `requestAnimationFrame` only while running, and only the timer text changes.

## Risks / open points
- iOS standalone PWAs have historically had camera quirks. Test on iOS 16.4+ (also the minimum for Wake Lock).
- Big lighting changes mid-game can make classification ambiguous. Mitigation: a "Recalibrate" button, mean-subtracted features, and the ambiguity threshold.
- Auto-exposure and auto-focus changes. Try setting `focusMode`/`exposureMode` to `continuous` where supported; otherwise accept the defaults.
- Audio on iOS needs a user gesture first. Unlock the `AudioContext` when the Start button is tapped.

## Next step
Write an implementation plan (`plans/camera-chess-clock.md`) with atomic steps: project scaffold, PWA config, clock state machine and tests, frame classifier and tests, camera module, calibration UI, game UI, alerts, wake lock and visibility handling, and the GitHub Pages deploy.
