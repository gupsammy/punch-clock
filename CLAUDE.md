# Punch Clock

Design lives in `DESIGN.md`; versus mode in `VERSUS.md`.

## Deploy

Vercel (personal team `gupsammys-projects`) is linked to GitHub `gupsammy/punch-clock`: a push to `main` deploys to production. Order:

1. `git pull` — PRs merge on origin.
2. Commit, push.
3. Curl https://punch-clock-game.vercel.app and confirm the new files are served. `punch-clock.vercel.app` and `punchclock.vercel.app` belong to other accounts.

CLI, for status or a manual deploy: `env -u AI_AGENT -u CLAUDECODE vercel --global-config ~/.vercel-personal …` (the CLI ignores the team scope while `AI_AGENT` is set). Always pass `--global-config`: plain `vercel` uses another login. `.vercelignore` keeps these notes off the live site. A deploy stuck at `UNKNOWN` is `BLOCKED`: the Hobby plan rejects a commit author it cannot match to the owner.

## Testing in the preview pane

A hidden pane stops `requestAnimationFrame` and pauses audio. Drive frames with `setInterval(() => __pc.step(), 16)`; use Worker timers for two-tab versus tests. Screenshots lag one call behind, so clear the interval before capturing. `?clean` hides the tutorial hint.

## Audio gotchas

- The iOS silent switch mutes Web Audio. Ask about it before debugging "no sound on iPhone".
- Synthesized noise longer than ~1 s sounds like static. Build sustained sounds (crowds, beds) from `vox()` voices.
- `crowdStart` / `setCrowd` in `src/audio.js` are dead: the crowd loop never starts, so `setCrowd` calls do nothing.
- Send AudioParam automation only when the target changes, never every frame.
