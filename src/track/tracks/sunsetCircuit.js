// World 1, track 1: the original flowing lap — long straight, banked sweeper,
// chicane, blind crest with airtime, hairpin, elevated esses crossing the
// final approach on a flyover.
export const SUNSET_CIRCUIT = {
  id: 'sunset-circuit',
  name: 'Sunset Circuit',
  world: 'desert',
  laps: 3,
  // Width is the lever for stakes: wide on straights (room to breathe + set up),
  // hard pinches at every apex so the brave inside line is genuinely committed
  // and the wall is reachable. Centerline (x/y/z) is untouched — only widths
  // changed — so the loop/jump/corkscrew/pad cp-references all stay valid.
  points: [
    { x: 0, y: 2, z: 280, width: 16 },    //  0 start/finish
    { x: 0, y: 2, z: 140, width: 14 },    //  1 |
    { x: 0, y: 2, z: 0, width: 15 },      //  2 | long start straight (loop entry — keep room)
    { x: 0, y: 2, z: -140, width: 15 },   //  3 | jump
    { x: 10, y: 3, z: -260, width: 16 },  //  4 straight end, opening for the fork
    { x: 70, y: 5, z: -350, width: 19 },  //  5 sweeper: FORK splits here (roomy lanes each side)
    { x: 180, y: 8, z: -395, width: 20 }, //  6 sweeper apex — island divides inside/outside
    { x: 290, y: 11, z: -360, width: 19 },//  7 lanes run parallel around the bend
    { x: 350, y: 13, z: -270, width: 16 },//  8 fork merges, sweeper exit
    { x: 330, y: 15, z: -180, width: 7 }, //  9 chicane left — PINCH (flick)
    { x: 395, y: 17, z: -110, width: 7 }, // 10 chicane right — PINCH
    { x: 420, y: 26, z: -20, width: 12 }, // 11 climbing, opens up
    { x: 425, y: 34, z: 60, width: 14 },  // 12 blind crest (wide for the airtime)
    { x: 410, y: 16, z: 150, width: 13 }, // 13 steep drop (landing room)
    { x: 380, y: 10, z: 230, width: 11 }, // 14 approach hairpin (braking zone)
    { x: 330, y: 8, z: 300, width: 8 },   // 15 hairpin entry — PINCH
    { x: 250, y: 7, z: 330, width: 6 },   // 16 hairpin apex — TIGHT (the signature commit)
    { x: 185, y: 8, z: 290, width: 8 },   // 17 hairpin exit (exit pad rewards a clean apex)
    { x: 120, y: 9, z: 290, width: 11 },  // 18 elevated esses (flyover)
    { x: 55, y: 9.5, z: 350, width: 8 },  // 19 esses apex — PINCH (on the elevated deck)
    { x: -40, y: 11, z: 295, width: 9 },  // 20 crosses OVER the final approach
    { x: -115, y: 6, z: 370, width: 12 },// 21 diving back down, clear of the straight
    { x: -220, y: 4, z: 320, width: 14 }, // 22 esses exit, heading west (opens)
    { x: -280, y: 3, z: 400, width: 15 }, // 23 valley sweeper south
    { x: -235, y: 2, z: 480, width: 15 }, // 24 (corkscrew — keep room for the roll)
    { x: -120, y: 2, z: 510, width: 16 }, // 25 along the south edge
    { x: -45, y: 2, z: 470, width: 17 },  // 26 sweeping back north (wide run home)
    { x: -4, y: 2, z: 385, width: 15 },   // 27 final approach, east of the flyover leg
  ],
  boostPads: [
    { cp: 1.2, d: -4 },  // risk line: a chain of three near the left wall
    { cp: 1.6, d: -4 },
    { cp: 2.0, d: -4 },
    { cp: 5.6, d: 8 },   // FORK fast lane: pad chain down the inside line
    { cp: 6.4, d: 9 },
    { cp: 7.2, d: 9 },
    { cp: 8.3, d: 0 },   // sweeper exit
    { cp: 10.5, d: 0 },  // chicane exit
    { cp: 12.0, d: 0 },  // top of the blind crest
    { cp: 17.4, d: 0 },  // hairpin exit
    { cp: 22.3, d: 0 },  // esses exit
    { cp: 25.2, d: 3 },  // south edge, near the right wall
  ],
  // Route forks: a raised island splits the road into two committed lanes over
  // [from,to] (cp indices). `gap` is the island half-width; `fast` is the side
  // (+1 right / -1 left) that's shorter and carries the pad chain — the brave
  // line. The other side is longer and open — the safe line.
  splits: [
    // The sweeper: inside (right) is shorter via the corner + boosted, but
    // pinned against the island; outside (left) is the safe long way round.
    { from: 4.9, to: 7.8, gap: 4.5, fast: 1 },
  ],
  features: [
    // A full loop on the long start straight, fed by the boost chain...
    { type: 'loop', cp: 2, dir: 1 },
    // ...then a jump where the straight ends, just before the sweeper.
    { type: 'jump', cp: 3.0, gap: 22, lift: 11 },
    // A barrel roll along the flat valley sweeper on the way home.
    { type: 'corkscrew', from: 24.0, to: 25.4, turns: 1, dir: -1 },
  ],
};
