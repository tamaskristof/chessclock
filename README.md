# Camera Chess Clock

A chess clock with no electronics on the table. A wooden board rests on a wedge like a seesaw. Each player ends their move by pressing their side of the board down. A phone on a stand watches the board with its back camera, works out which side is down, and runs the two clocks. It is an offline-capable PWA: after the first load it needs no network.

## Physical setup

- Put the phone on a stand with the back camera facing the board from 30–60 cm and the screen facing the players.
- Use even lighting.
- Do not move the phone after calibration.

## Usage

1. Tap "Start camera".
2. Drag a box tightly around the board.
3. Press the left side down and tap "Capture left". Press the right side down and tap "Capture right". Then tap "Done".
4. Choose a time control. The player who moves second presses their side down, then taps "Start". The clock of the player whose side is UP runs.
5. Each press of your side ends your move.
6. Use "Recalibrate" if the phone or the lighting changes.

## Development

- `npm install`, then `npm run dev` and open `http://localhost:5173/` (a desktop webcam works on localhost).
- Phones need HTTPS for the camera, so test on the deployed site.
- `npm run check` runs the typecheck and unit tests; `npm run build` makes a production build. `npm run icons` regenerates the icons.

## Deployment

- Run `npm run deploy`. It builds the app and force-pushes `dist/` to the `gh-pages` branch.
- In the GitHub repo under Settings → Pages, set the source to branch `gh-pages`, folder `/ (root)`.
- The app is built with a relative base (`./`), so it works under any Pages URL path.
- Install on the phone via "Add to Home screen".
