# Store / portal cover art

Hand-picked deliverables, kept in git because the choices behind them (which
backdrop, where the thumb zoom aims) are decisions, not output — `press/` is
gitignored and these would otherwise live nowhere.

| File | Size | Where it goes |
|---|---|---|
| `cover-wide-1920x1080.png` | 16:9 | Landscape cover slot, README, socials |
| `cover-tall-800x1200.png` | 2:3 | Portrait cover slot |
| `cover-square-800x800.png` | 1:1 | Square cover slot |
| `cover-thumb-1080.png` | 1:1 | GRID tiles — one subject, hard zoom, max contrast |
| `cover-itch-630x500.png` | 630x500 | itch.io cover (their documented size) |

Two different briefs on purpose. The first three are the title-card
composition, for surfaces that are LOOKED AT. The thumb is built for a
~250px tile next to thirty shouting neighbours, where negative space reads
as invisibility — a lesson bought with a 0.5% CTR on another title.

Regenerate: `node tools/hero-shot.mjs` (six backdrops), then
`node tools/hero-shot.mjs --bg 2 --zx 50 --zy 55`. Compose live by opening
`hero-lab.html?bg=press/hero/bg-2.png&layout=wide` over the dev server.
