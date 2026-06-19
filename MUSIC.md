# Music — Suno prompts

Martin composes the game's music himself (in Suno) — these are the prompts to
author the loops, not generated audio. Drop the finished files into
`assets/music/`; missing files just mean silence for that slot (never an error).

## Slots

| File | Where it plays |
|------|----------------|
| `menu.mp3`   | the menus (from the title screen) |
| `sunset.mp3` | **Sunset Mesa** — Sunset Circuit, Mesa Run |
| `coast.mp3`  | **Palm Coast** — Lagoon Pass, Coral Keys (tracks 3 & 4) |
| `sprawl.mp3` | **Neon Sprawl** — Orbital Ring, Skyline Rush |
| `race.mp3`   | fallback for any world track that's missing |

The game loops tracks **gaplessly** with an equal-power crossfade (`core/audio.js`),
so you don't need a manual fade-out — just keep the energy consistent end to end.

## The recipe (make it race, not pause)

If a track comes out feeling like pause/ambient music, the prompt was missing
drive. Always:

- **State a high BPM** (138–172) and `instrumental`.
- Add energy words: *driving, relentless, propulsive, pumping, four-on-the-floor*.
- Add `no ambient intro, no breakdown, full energy throughout, seamless loop`.
- A **WipEout / F-Zero** reference steers Suno toward racing energy.

Avoid (these produce pause music): *chill, lo-fi, downtempo, dreamy, relaxing,
atmospheric, ambient, ballad*. If Suno has an "exclude styles" box, put those there.

## Prompts (paste into Suno's "Style of Music"; put `[Instrumental]` in lyrics)

**Menu** — anticipation, not a full race:
```
driving retro-futuristic synthwave, 138 BPM, instrumental, pulsing arpeggio, punchy gated drums, confident neon outrun energy, propulsive, no ambient intro, consistent energy, seamless loop
```

**Sunset Mesa** (`sunset.mp3`):
```
high-energy outrun darksynth, WipEout-style racing, 150 BPM, instrumental, relentless four-on-the-floor kick, sidechained saw bass, soaring neon lead, sunset desert speed, no breakdown, full energy throughout, seamless loop
```

**Palm Coast** (`coast.mp3` — tracks 3 & 4; push the energy hardest here, the
tropical vibe tempts Suno to go mellow):
```
fast tropical synthwave electro racing anthem, F-Zero energy, 155 BPM, instrumental, punchy breakbeat over four-on-the-floor, bright plucky arps, surging bassline, sunlit high-speed euphoria, NOT chill, no ambient intro, no breakdown, driving and relentless, seamless loop
```

**Neon Sprawl** (`sprawl.mp3`):
```
aggressive cyberpunk darksynth meets drum and bass, 172 BPM, instrumental, distorted reese bass, rapid breakbeat, neon city night chase, intense and propulsive, no breakdown, max energy start to finish, seamless loop
```

## Tips

- Generate 2–3 takes and pick the one that **starts at full energy** (no slow
  build-up) — the loop point is its very start.
- Keep them ~1.5–2 min; the gapless loop handles the seam.
- Faster classes (SURGE / OVERDRIVE) feel even better with the higher-BPM
  worlds, so don't be shy with tempo.
