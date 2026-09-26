# PUNCH CLOCK — 1v1 VERSUS

Two friends, one link, first-person on both ends. You see your own gloves; your friend is the fighter
in front of you. The single-player loop (read, dodge, punish) runs on both sides at once: each player
throws telegraphed attacks like a boss and fast punches into openings like the player.

## Flow
Title → **1V1** → lobby (room link: COPY / SHARE) → friend opens link → **character select** (both,
live) → both locked → intro card "YOU vs THEM" → fight → **result** (REMATCH / NEW FIGHTERS / LEAVE).
The room creator is the **host**: it starts the fight and owns the round clock. Nothing else differs.

## Network
- **Peer-to-peer WebRTC** through Trystero (`vendor/trystero/trystero-nostr.js`, one bundled ES module,
  loaded only when versus starts). Public Nostr relays carry the handshake; after that the browsers talk
  directly. The Vercel deploy stays static.
- A link is `?vs=CODE` (6 characters). App id `punch-clock-vs-1`. Rooms take two players; a third is
  ignored.
- About 1 in 10 networks block a direct link. Then the lobby says so. Fix later by adding a TURN server
  to `turnConfig` in `net.js`; nothing else changes.
- **Dev transport**: `?vs=CODE&net=local` swaps WebRTC for a BroadcastChannel between two tabs on one
  origin. `&lag=MS` delays every message both ways on either transport, to test lag.
- One message stream, ordered and reliable (low volume: events, not frames). Round-trip time is
  measured every 2 s; one-way delay (`owd`) = RTT / 2, smoothed.

## Authority (who decides what)
Every rule below keeps a hit fair *on the screen of the player who could have avoided it*.
- **Telegraphed attacks: the defender decides.** The attacker sends `atk` at wind-up start. The defender
  plays the wind-up shortened by `owd` (never below half), so both strike at about the same wall time,
  then resolves it against their own dodge and sends `res` (hit / dodge / perfect). The attacker's glove
  holds out until `res` arrives (≈ the strike's own 0.1–0.15 s); no result in 1 s counts as a dodge.
- **Punches: the puncher decides**, against the opponent's last replicated state (open, dodging,
  guarding). The puncher sends `pun` with damage; the owner applies it. Late hits by at most `owd` are
  accepted, as in most netcode.
- **Your body is yours**: HP, guard, meter, knockdowns, get-ups and your state machine run only on your
  client. Every change goes out as a `st` snapshot; the opponent renders you from it.
- Interrupts: a punch that lands on an interruptible wind-up sends `pun{interrupt}`; the defender
  cancels its scheduled strike at once, the owner cancels the attack on arrival.
- The sim runs on **real time**. Hit-stop is visual only; versus has no slow motion (a slowed clock on
  one side would drift the two timelines apart).

## Mirroring
You face each other, so your left hand is on your opponent's screen-right. Attacks travel in the
sender's terms and flip on arrival: hand L↔R, and each `avoid` direction left↔right. A dodge left on
your screen is a slip to the right on theirs. `hookL` from you is `hookR` to them: dodge left or duck.

## Combat (per player)
- **Tap** punch (L or R, released under 0.2 s): fast punch. Lands only on an **opening** (opponent
  recovering from a whiffed attack, stunned, hurt, or 0.12 s into an interruptible wind-up = interrupt).
  A dodging opponent makes it whiff. Otherwise it hits the guard.
- **Hold** punch (0.2 s): the character's heavy attack for that hand, with a full tell. The wind-up
  starts at the hold threshold, not on release.
- **Special** (Space / swipe up / Y) with a full meter: the character's signature, often a flurry.
  Each flurry wind-up is at least 0.3 s before lag trims it, and hits after the opener deal 70 %, so an
  undodged special hurts (about half a bar) without ending the fight.
- **Dodge** left / right / duck, same timings and avoid rules as single player; PERFECT inside the last
  0.12 s stuns the attacker. Dodging in the first 60 % of your own wind-up cancels it (a feint).
- **DISRESPECT** (from the ladder): the first hit on a player who is taunting (phone, flex, sip, nap)
  deals ×2.2 (×2.5 on a nap) and gives the hitter 20 meter; the victim is stunned 0.8 s.
- **Guard** (anti-turtle): 100 points unless the character says otherwise, regenerates 25/s after 0.8 s untouched. Blocked punches drain
  it; at 0 → GUARD BROKEN, stunned 1 s. Pressure beats waiting.
- Rock-paper-scissors: punch pressure beats turtling; armored heavies (uppercut, smash, specials) beat
  punch pressure; dodges beat attacks and make punches whiff.
- **Meter**: perfect dodge +30, dodge +8, counter/interrupt +10, attack landed +12, damage taken
  +0.5 × damage.
- **Knockdowns**: HP 0 → down; mash to rise before 10 (single-player rule, both sides see the count).
  Third knockdown or a count of 10 = K.O. Round clock 2:00; at time the host decides by knockdowns,
  then HP %.
- Disconnect in a fight = the one left wins by forfeit ("OPPONENT CLOCKED OUT").

## Characters
Each has a move set, a punch profile, four 1–5 bars on the select card (POWER, SPEED, HEALTH, TRICKS),
and a **perk** and a **flaw** taken from their ladder gimmick. Numbers and card text live in `VS` in
`config.js`; the trait rules live in `versus.js`.

| | HP | Perk | Flaw |
|---|---|---|---|
| Kyle | 90 | NOTHING TO LOSE: under 30 % HP, punches +35 %, meter ×1.5 | PHONE CHECK: idle 3 s → phone out, open 1.2 s |
| Brenda | 100 | PAPER TRAIL: 4 blocks in a row → automatic fast counter | SIP BREAK: after her special lands, open 1.2 s |
| Chad | 110 | GRINDSET: guard 130 | FLEX: after any attack lands, open 0.8 s |
| Derek | 100 | BILLABLE HOURS: each attack landed takes 20 of your meter; feints until 85 % of a wind-up | NO SKIN IN THE GAME: any wind-up, specials too, can be interrupted after 0.04 s |
| Margaret | 95 | WHO DARES: woken by a hit → FURIOUS: full meter, +25 % power for 5 s | NAPS: every 18–28 s, the next time she is idle, asleep 2.6 s (5 taps wake her) |
| Roland | 105 | GOLDEN PARACHUTE: first knockdown, straight back up at 50 %, jacket off, +15 % power | SHAREHOLDERS: guard 70 |

Buffs that change damage (Kyle, Margaret, Roland) travel with each attack (`pw`), since the defender
computes the damage.

| | Hold L | Hold R | Special | Punches |
|---|---|---|---|---|
| Kyle | quick jab | coffee throw | NETWORKING (jab, jab, jab, throw) | fast, light |
| Brenda | hook | write-up throw | PERFORMANCE REVIEW (jab, jab, hook) | normal |
| Chad | uppercut | uppercut | PIVOT | heavy |
| Derek | hook | business-card throw | RESTRUCTURING (4 hooks, uppercut) | fast |
| Margaret | hook | smash | BACK IN MY DAY (jab, jab, hook, hook, smash) | heavy |
| Roland | HOSTILE TAKEOVER | cash throw | LAYOFFS (lights out on the victim's screen) | heavy |

## Select screen (POV)
The camera sits where you fight. The fighter your friend is hovering stands in the ring in front of
you and swaps live as they browse; your gloves take your pick's glove colour. Your card (name, bars,
good at / watch out, moves) sits on the left; six face tiles along the bottom (faces drawn by the
fighter's own face painter). Keys: A/D or arrows browse, J/Enter lock in, Esc unlock/leave. Touch: tap
a tile, tap LOCK IN. The ring wears your opponent's floor: you fight on their turf.

## Messages
`hi{v, r}` · `sel{c, ready}` · `go{}` · `st{hp, max, kd, meter, guard, gm, s, dir, side, tk, fu, jk}` ·
`atk{n, id, wind, prop, fl, pw}` · `cx{n}` · `res{n, r, dmg}` · `pun{side, kind, dmg, cap}` · `count{n}` · `ko{}` ·
`end{win}` · `again{}` · `pick{}`. The higher random `r` in `hi` is the host. Version mismatch on `hi` → lobby shows "UPDATE: RELOAD THE PAGE".

## Code
```
src/net.js       transport (Trystero or BroadcastChannel), lag sim, ping
src/versus.js    Versus: local body + remote render + resolution rules (plays the role of Fight)
src/config.js    VS: per-character versus stats and moves
src/main.js      lobby, select, result screens; routes input to Versus
src/player.js    per-glove materials, wind-up poses, glove colour
src/fighter.js   slip and duck poses; face painter exported for select tiles
src/input.js     hold mode: touch reports press and release so holds work
```
Not in v1: clip recording, share card, company chat feed, spectators, matchmaking with strangers.
