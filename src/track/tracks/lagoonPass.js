// World 2, track 1: a coastal pass over the lagoon — start on the crest,
// dive to the water, climb a chicaned S back up, blind drop, and a flyunder
// beneath the climbing section on the way home.
export const LAGOON_PASS = {
  id: 'lagoon-pass',
  name: 'Lagoon Pass',
  world: 'tropic',
  laps: 3,
  // Width is the lever for stakes: wide on straights (room to breathe + set up),
  // hard pinches at every apex so the brave inside line is genuinely committed
  // and the wall is reachable. Centerline (x/y/z) is untouched — only widths
  // changed — so the corkscrew/loop/pad cp-references all stay valid.
  points: [
    { x: 0, y: 20, z: 0, width: 16 },     //  0 start/finish on the crest
    { x: 0, y: 16, z: -130, width: 15 },  //  1 descending, tightening
    { x: -30, y: 12, z: -250, width: 7 }, //  2 first apex (right) — PINCH
    { x: -120, y: 8, z: -330, width: 14 },//  3 shoreline left sweep (corkscrew — keep room)
    { x: -240, y: 6, z: -330, width: 15 },//  4 water level (corkscrew roll — keep room)
    { x: -330, y: 8, z: -240, width: 14 },//  5 wide left (corkscrew exit)
    { x: -340, y: 12, z: -120, width: 12 },// 6 climb begins, narrowing into the chicane
    { x: -280, y: 18, z: -10, width: 9 }, //  7 chicane flick (left) — PINCH
    { x: -300, y: 24, z: 110, width: 6 }, //  8 climbing chicane apex — TIGHT (the commit)
    { x: -210, y: 28, z: 180, width: 8 }, //  9 chicane exit — PINCH, opening
    { x: -110, y: 30, z: 150, width: 15 },// 10 high plateau (wide, room to breathe)
    { x: -40, y: 26, z: 230, width: 13 }, // 11 blind drop entry (room for the airtime)
    { x: -60, y: 18, z: 350, width: 17 }, // 12 diving left — opening for the fork
    { x: -170, y: 12, z: 420, width: 19 },// 13 sweeper: FORK splits here (roomy lanes each side)
    { x: -290, y: 10, z: 400, width: 20 },// 14 sweeper apex — island divides inside/outside
    { x: -380, y: 10, z: 290, width: 18 },// 15 fork merges, sweeper exit (lanes rejoin)
    { x: -350, y: 8, z: 170, width: 9 },  // 16 the flyunder (passes BELOW cp8-9) — PINCH into it
    { x: -260, y: 6, z: 90, width: 13 },  // 17 flyunder exit, opening onto the lagoon
    { x: -140, y: 4, z: 40, width: 16 },  // 18 lagoon run home (loop — keep room)
    { x: -50, y: 10, z: 90, width: 16 },  // 19 final climb to the crest (loop exit — keep room)
  ],
  boostPads: [
    { cp: 1.3, d: 0 },   // the dive
    { cp: 4.5, d: 0 },   // shoreline exit
    { cp: 7.3, d: 0 },   // climb
    { cp: 9.5, d: 0 },   // chicane exit
    { cp: 11.0, d: 0 },  // plateau edge, before the blind drop
    { cp: 13.4, d: 8 },  // FORK fast lane: pad chain down the inside (right) line
    { cp: 14.0, d: 8 },
    { cp: 14.6, d: 8 },
    { cp: 18.4, d: 0 },  // final climb chain
    { cp: 18.8, d: 0 },
  ],
  // Weapon pickups (gold): straights, offset from the boost lines.
  weaponPads: [
    { cp: 2.2, d: 3 },
    { cp: 5.2, d: -3 },
    { cp: 10.2, d: 3 },
    { cp: 16.4, d: -3 },
    { cp: 19.3, d: 3 },
  ],
  // Route forks: a raised island splits the road into two committed lanes over
  // [from,to] (cp indices). `gap` is the island half-width; `fast` is the side
  // (+1 right / -1 left) that's shorter and carries the pad chain — the brave
  // line. The other side is longer and open — the safe line.
  splits: [
    // The diving low sweeper: inside (right) is shorter through the bend +
    // boosted, but pinned against the island; outside (left) is the long way
    // round and open. (Right is inside: the bend curves with positive turn.)
    { from: 13.0, to: 15.0, gap: 4.5, fast: 1 },
  ],
  features: [
    // Barrel roll along the flat shoreline, then a full loop on the run home.
    { type: 'corkscrew', from: 3.1, to: 4.3, turns: 1, dir: 1 },
    { type: 'loop', cp: 18, dir: 1 },
  ],
};
