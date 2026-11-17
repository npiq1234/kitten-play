# Kitten Play

A simple iPad game for cats. Fish, mice, ladybugs, butterflies and a laser dot move around the screen. When your cat hits one, it pops with a bright flash and a new one arrives a moment later.

There's no login, no tracking and no ads. Settings are saved on the iPad only.

## Modes

| Mode | What moves |
|---|---|
| Fish | Fish swim in loose schools in a top-down tank, then leave the screen and come back. |
| Mice | Mice scurry, stop to sniff, then dart off in a new direction. |
| Ladybugs | Ladybugs crawl slowly with small turns and pauses. |
| Butterflies | Butterflies flutter in loops over a meadow. |
| Laser Dot | One or two red dots jump, hold still, then dart away. |
| Mix | Fish, mice, ladybugs and butterflies together. |

A near miss makes the creature dart away from the paw. The hit area is larger than the drawing, because paws aren't precise.

## Settings

- **Speed:** Slow, Normal or Fast.
- **How many:** 1 to 5 creatures on screen. Laser Dot uses at most 2.
- **Sound:** a soft sound plays on each catch, with quiet bubbles in Fish mode and the odd squeak in Mice mode.

Sound won't play while the iPad's silent mode is on.

## Leaving a game

Hold your finger on the top-left corner for 3 seconds. A ring fills up while you hold. A quick tap does nothing, so a paw won't exit by accident.

## Install on the iPad

1. Turn on GitHub Pages for this repo: **Settings > Pages > Build and deployment > Deploy from a branch > `main` / `(root)` > Save**. GitHub Pages is free for public repos. A private repo needs GitHub Pro.
2. After a minute or two, open `https://npiq1234.github.io/kitten-play/` in **Safari** on the iPad.
3. Tap **Share > Add to Home Screen > Add**.
4. Open Kitten Play from the Home Screen. It runs full screen and works offline after the first launch.

To pick up an update, open the app once while online, close it, then open it again.

## Lock the iPad to the game (Guided Access)

The app can't stop a paw from swiping to the Home Screen or opening Control Center. Guided Access can.

1. Go to **Settings > Accessibility > Guided Access** and turn it on.
2. Tap **Passcode Settings** and set a passcode.
3. Open Kitten Play and start a game.
4. Triple-click the top button (or the Home button on older iPads), then tap **Start**.
5. To finish, triple-click again and enter your passcode.

The screen stays awake during play on recent iPadOS versions. If it dims anyway, set **Settings > Display & Brightness > Auto-Lock** to Never while your cat plays.

## Run it on a computer

```
python3 -m http.server 8000
```

Then open `http://localhost:8000`. Any static file server works. There's no build step and nothing to install.

## Files

| File | Purpose |
|---|---|
| `index.html` | Menu and game screen |
| `style.css` | Menu styling |
| `game.js` | Movement, drawing, catch effects, sound and settings |
| `sw.js` | Offline cache |
| `manifest.webmanifest`, `icons/` | Home Screen name and icon |

All the artwork is drawn in code and all the sounds are generated in code, so there are no image or audio files to license.

## A note on screens

Kitten claws scratch glass. A matte screen protector is worth it.
