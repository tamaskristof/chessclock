# Camera Chess Clock

A chess clock with no electronics on the table. A wooden board rests on a wedge like a seesaw. Each player ends their move by pressing their side of the board down. A phone on a stand watches the board with its back camera, works out which side is down, and runs the two clocks. It is an offline-capable PWA: after the first load it needs no network.

## Physical setup

- Put the phone on a stand with the back camera facing the board from 30–60 cm and the screen facing the players.
- Use even lighting.
- Do not move the phone after calibration.

## Usage

1. Tap "Start camera". The first time, a four-step calibration starts:
   1. **Frame:** drag a box tightly around the plank (drag the corners to adjust).
   2. **Left:** press the left side down, tap "Capture".
   3. **Right:** press the right side down, tap "Capture".
   4. **Test:** press each side once and check the app sees it, then "Done".
2. On the New game screen, pick a time control. Name and rating for each player are optional; the magnifier button looks a player up on chess.com by exact username and fills in their rating for the category that matches the time control (under 3 min bullet, under 10 min blitz, otherwise rapid, using minutes + 40 x increment).
3. The player who moves second presses their side down; the board pill shows what the camera sees. Tap "Start game". The clock of the player whose side is UP runs.
4. Each press of your side ends your move. Hundredths appear under 20 seconds.
5. The pause button opens Resume, New game and Recalibrate. After a flag, "Rematch" swaps the players' seats (names and ratings swap sides) and returns to New game.

## Development

- `npm install`, then `npm run dev` and open `http://localhost:5173/` (a desktop webcam works on localhost).
- Phones need HTTPS for the camera, so test on the deployed site.
- chess.com lookups call `api.chess.com` straight from the browser and need a connection; everything else works offline. The fonts (Barlow, Barlow Condensed) are bundled, not loaded from a CDN.
- `npm run check` runs the typecheck and unit tests; `npm run build` makes a production build. `npm run icons` regenerates the icons.

## Deployment

- Every push to `main` runs `.github/workflows/deploy.yml`: it installs dependencies, runs `npm run check`, builds, and deploys `dist/` to GitHub Pages. It can also be started by hand from the Actions tab.
- The site is served at https://tamaskristof.github.io/chessclock/.
- The app is built with a relative base (`./`), so it works under any Pages URL path.
- Install on the phone via "Add to Home screen".
