# PUNCH CLOCK — design

> You've been laid off. HR says there's one opening left. It's on the top floor.

A first-person, Punch-Out-style boxing game in the voice of a Devolver Digital release:
corporate satire, neon violence, instant retries, and a result screen worth screenshotting.
Runs in any modern browser with no build step (Three.js vendored, ES modules).

## Pillars
1. **Read, dodge, punish.** Every enemy attack has a clear tell. Dodge it, then punch the opening.
   Mashing into a guard gets you countered.
2. **Juice on every input.** Hit-stop, screen shake, camera kick, chromatic flash, particles, layered sound.
3. **Instant retry.** Losing is one keypress from fighting again (Hotline Miami's rule).
4. **Every fight is a clip.** Fights run 45–120 s, end in a slow-motion KO, and produce a share card.
5. **Jokes in the systems, not only the text.** The consultant bills you per punch; grandma naps mid-fight.

## Controls
| Action | Keyboard | Mouse | Touch | Gamepad |
|---|---|---|---|---|
| Left jab | J / Z | left click | tap left half | X / □ |
| Right cross | K / X | right click | tap right half | B / ○ |
| Dodge left / right | A / D, ← / → | — | swipe left / right | stick / d-pad |
| Duck | S / ↓ | — | swipe down | stick down |
| Haymaker (meter full) | Space | middle click | swipe up | Y / △ |
| Pause | Esc / P | — | ❚❚ button | Start |
| Retry | R | — | pause menu | Select |

## Combat rules
- **Dodge**: 0.42 s active (held: up to 0.6 s, so it can't be pre-held), then 0.14 s recovery; a new
  dodge can start during recovery. An avoided attack ends the dodge at once so the punish is usable.
  Dodging within the last 0.12 s before impact is a **PERFECT** dodge: slow motion, stun, meter.
- One rule covers every attack: jabs miss any dodge; hooks and spins can be ducked; everything else
  — dodge away from the glowing glove. No single direction beats the roster.
- **Tempo**: each opponent's `idle` range sets how long they linger between moves.
- **Guard**: an idle opponent guards. Punches into the guard are blocked; four blocks in a row
  trigger a quick parry-counter with a short tell.
- **Openings**: after a whiffed attack (recover), after a perfect dodge (stun), during taunts
  (hit = DISRESPECT, big damage). Landed hits chain a combo; damage scales with combo.
- **Haymaker**: meter full → Space. 0.35 s wind-up, 22 damage (14 into a guard), finishes under 6 HP.
- **Knockdowns**: opponent HP 0 → falls, ref counts. Each opponent needs N knockdowns; the last is the KO.
  The KO must be a statement punch — the first hit of a counter/interrupt, a perfect-dodge punish,
  a DISRESPECT hit, or a haymaker. Anything else leaves them HANGING ON at 1 HP.
  Player HP 0 → mash punches to stand before 10. Third knockdown = YOU'RE FIRED.

## Roster (the corporate ladder)
| Floor | Opponent | Gimmick | KDs |
|---|---|---|---|
| B1 | Kyle, Unpaid Intern | Tutorial. Slow tells, throws coffee, checks phone (taunt) | 1 |
| 3 | Brenda from HR | Double jabs, PERFORMANCE REVIEW flurry, throws write-ups | 2 |
| 12 | Chad, VP of Synergy | Flexes, uppercuts, PIVOT spin backfist | 2 |
| 27 | Derek, Consultant ($900/hr) | Feints, fast combos, invoices you per hit taken | 2 |
| 44 | Margaret, Chairwoman of the Board, 94 | Naps (free hits, wakes furious), BACK IN MY DAY 7-hit flurry, throws dentures | 3 |
| 60 | Roland Vantablack III, CEO | Golden gloves, LAYOFFS (lights out), HOSTILE TAKEOVER, jacket-off phase 2 | 3 |

## Screens
Title (punch-card logo, attract loop) → Floor select (elevator) → Intro card (slanted name slam,
stats, tagline) → Fight → KO slow-mo → **Performance Review** (grade, stats, share card) → next floor.
Lose → **YOU'RE FIRED** → R to reapply.
Menu screens change under a wipe: the swap happens behind a full cover, then an ink panel and a pink
panel slide off. The fight itself starts with no wipe. `?clean` hides the tutorial hints, for footage.

Grades: S "EXCEEDS EXPECTATIONS", A "STRONG PERFORMER", B "MEETS EXPECTATIONS", C "NEEDS IMPROVEMENT", D "PIP".

## Daily Shift (career run)
A second mode beside the ladder. Title → **DAILY SHIFT #N** → shift memo (today's modifier, pick one
perk) → all six floors back to back, no elevator. N = days since 2026-09-01; everyone gets the same
modifier on the same day (chosen from N, not random).
- **Clock**: the shift time is the sum of in-fight time on every attempt, failures included.
- **Sick days**: 3 lives. Getting fired spends one and replays the floor; at 0 the shift ends.
- **HP carries**: next floor starts at min(100, HP left + 40).
- **Daily modifier** (one per day): CASUAL FRIDAY (opponents 15% faster), BUDGET CUTS (no OVERTIME),
  SYNERGY SUMMIT (combo damage ×1.5, opponents +25% HP), RETURN TO OFFICE (hits hurt 25% more),
  OPEN PLAN (props fly 3× as often), LAYOFFS WEEK (a 2.5 s blackout every 14 s).
- **Perks** (equip one; unlocked by an A or S on that floor in the ladder):
  Kyle's lanyard +1 sick day · Brenda's file voids the first hit you take each floor ·
  Chad's podcast fills OVERTIME 50% faster · Derek's deck names the dodge for each attack ·
  Margaret's seat starts every floor at full HP · Golden parachute survives one T.K.O.
- **Report**: time, floor reached, one square per floor — 🟩 clean, 🟨 needed sick days, 💀 ended here,
  ⬛ not reached. Share line: `PUNCH CLOCK SHIFT #N · CEO in 7:42 · 🟩🟩🟨🟩🟩🟩 · CASUAL FRIDAY`
  plus `✅ NO PERKS` or `🧷 <perk>` so assisted runs are marked.
- Shift fights never touch ladder bests or unlocks.

## Clips
Every fight records the canvas (with a drawn broadcast overlay: HP bars, names, clock, latest callout,
boss quote, #PUNCHCLOCK) plus game audio. Two recorders restart every 8 s, 4 s apart, so one always
holds the last 4–8 s. A KO or a knockdown marks the older one; it keeps rolling 3.6 s, then stops.
A KO or firing keeps the clip; getting back up drops it. Only a kept clip gets the 1 s end card
(K.O.! or FIRED, boss, time): every recorder draws from one canvas, so a card for an undecided
knockdown would leak into the next clip. Clip timing runs on game frames, so pausing pauses it.
Share screen opens on the clip with a CLIP/CARD toggle (native share of the file where supported,
download otherwise). mp4 where the browser records it, webm otherwise. Longest side 1280 px, 720 on touch.

## Phones and tablets
- Touch: tap left/right half to punch, swipe to dodge/duck, swipe up for OVERTIME, ❚❚ button to pause.
  Copy that names keys (PRESS ANY KEY, (R)) swaps to touch wording.
- Portrait works: FOV widens to keep the boss framed. Under 560 px the HUD stacks name over title,
  the invoice moves to the bottom right. In portrait the elevator dossier sits on top and the camera
  tilts until the boss clears it.
- Screens that can outgrow the viewport scroll; on narrow or short screens their action row sticks
  to the bottom, so NEXT / START is never below the fold.
- Haptics on Android: perfect dodge, taking a hit, knockdown, KO.
- If a fight runs under 45 fps for 2 s, quality drops one step: MSAA 4x → 2x, then the pixel ratio a
  quarter step at a time down to 1, then MSAA off with FXAA in its place.

### Frame cost
- Only the scene target is multisampled. Bloom runs at half size and is not blended back; one grade
  pass adds it, runs the screen effects, tone maps and writes sRGB straight to the canvas. The canvas
  has no depth buffer and no MSAA of its own. This cut a 1080p@2x frame on an M3 Pro from 12 ms of GPU
  time to 5.
- The HUD and chat write to the DOM only when a value changes, and the speech bubble moves with
  `translate`, so a frame does not force a page layout for text that looks the same.

## Look
Dark arena, neon ring ropes, volumetric spotlights, crowd of office-worker silhouettes with phone flashes,
motivational neon signs. Each floor has its own two-colour palette. Post: bloom, chromatic aberration pulse,
grain, vignette, scanlines. Characters: toon-shaded primitives with outlines, canvas-drawn faces that
change expression, spring-driven poses so every hit wobbles.

Type: big slanted condensed caps (Anton), mono for stats (JetBrains Mono).

### Light
- **Tone curve:** Khronos PBR Neutral instead of ACES. ACES pulls hot neon toward orange and burns
  skin; Neutral keeps each floor's hues and only rolls off the top.
- **Toon ramp:** four bands, not three. Shadows lean cool violet, the lit band leans warm, so a
  character reads as lit from the key even in a single frame.
- **Each floor has its own light** (`theme.light`): key colour and strength, fill, fog, haze, exposure,
  and an optional tube flicker. The rig stays in the same place; only its colour and strength change.

| Floor | Mood | Hero prop (ringside, far corner) |
|---|---|---|
| B1 Mailroom | cold green-white strip lights that buzz and flicker | parcels stacked on a hand truck |
| 03 HR | soft, even, beige "wellness" light, violet haze | a potted office plant |
| 12 Synergy | hot orange gym light, hard shadows, thick haze | a barbell on a rack |
| 27 Strategy | clinical white projector light, crisp, little haze | a whiteboard with a line going up |
| 44 Boardroom | dim amber tungsten, deep shadows | a grandfather clock |
| PH Penthouse | gold key light, brighter overall | a giant gold trophy |

Props sit outside the far ropes, tall enough to show over the ring edge from the fight camera.

## Caricature and tells
Each boss is a silhouette you could read with the lights off.
- **Shapes** (`look.shape`): shoulder width, waist, hips, arm and leg thickness at each end, leg length.
  Kyle is a noodle with a big head; Brenda is a pear; Chad is a wedge with Popeye forearms and no legs
  worth mentioning; Derek is tall and narrow; Margaret is small, hunched, big-headed, on sticks;
  Roland is a barrel on short legs.
- **Torso** is a lathe profile (waist → chest → shoulders) per boss, scaled into a unit cylinder so floor
  contact treats it as one. **Limbs** taper: every segment is a cylinder with its own end radii.
- **Outlines** use a copy of each shape with smoothed normals, so the ink stays closed at box and
  cylinder edges.
- **Secondary motion**: ties, bob and bun hair, and bellies hang on springs driven by torso movement.

Tells:
- The windup pose snaps in with overshoot, so the shape reads in the first frames.
- The whole body shows the attack: jabs rock back a little, hooks coil and dip a shoulder, uppercuts
  crouch (squash), smashes rise up tall (stretch), throws wind the arm far back.
- The telling glove trembles and swells as the strike nears.
- The glint pops white for 0.08 s when the strike starts, then goes out; on a throw it goes out as the
  prop leaves the hand. The glint keeps a steady size on screen however close the glove gets.
- **Lens guard**: no arm ever passes through your camera. If a punch's shoulder-to-glove path would
  enter a sphere around the lens (0.36 m × glove size), the glove stops where the path meets it. This
  holds whichever way you dodge.
- **KO cut**: after the KO hit-stop the camera cuts to a low ringside angle that tracks the body through
  the flight, and holds there until results.

## Code map
```
index.html, styles.css, serve.py
src/main.js           boot, loop, screen state machine
src/config.js         roster, attacks, lines, palettes
src/fight.js          combat rules, opponent AI, scoring
src/fighter.js        opponent rig, IK arms, spring poses, sway springs, face canvas
src/materials.js      toon materials, outline hulls, lathe torsos, tapered limbs
src/player.js         first-person gloves and camera motion
src/arena.js          ring, ropes, lights, crowd, signs, themes
src/post.js           scene target, bloom, one grade pass to the canvas
src/fx.js             particles, projectiles
src/audio.js          procedural music + sfx (Web Audio)
src/input.js          keyboard, mouse, touch, gamepad
src/ui.js             HUD, popups, speech bubbles, screens, share card
src/spring.js         spring + math helpers
src/feed.js           company chat reacting to the fight
src/shift.js          daily shift: modifiers, perks, run state, report
src/clip.js           rolling canvas+audio recorder, clip overlay, end card
```
Run: `python3 serve.py` in this folder, open http://localhost:8777.
