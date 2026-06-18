// World 3, track 2: the mountain stage of the city — launch straight with a
// full F-Zero LOOP (cp 2-8), switchbacks up between the towers to a 44m
// summit, then a dive that crosses OVER the straight on the way home.
export const SKYLINE_RUSH = {
  id: 'skyline-rush',
  name: 'Skyline Rush',
  world: 'city',
  laps: 3,
  // Width is the lever for stakes: wide on straights (room to breathe + set up),
  // hard pinches at every apex so the brave inside line is genuinely committed
  // and the wall is reachable. Centerline (x/y/z) is untouched — only widths
  // changed — so the loop/jump/pad cp-references all stay valid. Stunt sections
  // (the loop cp 2-8 and the summit jump cp 18.3) stay wide for room.
  points: [
    { x: 0, y: 4, z: 250, width: 16 },    //  0 start/finish, heading north
    { x: 0, y: 3, z: 120, width: 16 },    //  1 launch straight (corkscrew into the loop — keep room)
    { x: -16, y: 3, z: 60, width: 13 },   //  2 LOOP entry (bottom — keep wide)
    { x: -10.7, y: 23, z: 25, width: 13 },//  3 climbing the face
    { x: -5.3, y: 63, z: 25, width: 13 }, //  4
    { x: 0, y: 83, z: 60, width: 13 },    //  5 the top, over the launch straight
    { x: 5.3, y: 63, z: 95, width: 13 },  //  6
    { x: 10.7, y: 23, z: 95, width: 13 }, //  7
    { x: 16, y: 3, z: 60, width: 13 },    //  8 LOOP exit (bottom, 32m over — keep wide)
    { x: 0, y: 4, z: -10, width: 16 },    //  9 straight resumes (wide run-up)
    { x: 30, y: 8, z: -140, width: 15 },  // 10 climb begins (wide approach into the flank)
    { x: 130, y: 14, z: -220, width: 8 }, // 11 right sweep apex — PINCH (up the flank)
    { x: 250, y: 20, z: -180, width: 7 }, // 12 switchback right apex — TIGHT
    { x: 290, y: 26, z: -70, width: 13 }, // 13 opens between the switchbacks
    { x: 230, y: 32, z: 30, width: 8 },   // 14 climbing hard — PINCH (left switchback entry)
    { x: 120, y: 38, z: 60, width: 7 },   // 15 switchback left apex — TIGHT
    { x: 40, y: 44, z: 0, width: 13 },    // 16 SUMMIT (wide for the blind crest)
    { x: -60, y: 40, z: -60, width: 14 }, // 17 over the top (landing room)
    { x: -160, y: 30, z: -20, width: 14 },// 18 descent (jump — keep wide)
    { x: -200, y: 20, z: 90, width: 14 }, // 19 diving left (jump landing room)
    { x: -120, y: 16, z: 120, width: 18 },// 20 lining up the crossover — FORK opens here
    { x: 20, y: 13, z: 140, width: 20 },  // 21 FLYOVER: island divides inside/outside
    { x: 120, y: 6, z: 220, width: 19 },  // 22 lanes run parallel, hooking back
    { x: 80, y: 4, z: 330, width: 16 },   // 23 fork merges, sweeper exit
    { x: -10, y: 4, z: 350, width: 8 },   // 24 final corner onto the line — PINCH
  ],
  boostPads: [
    { cp: 0.4, d: 0 },   // launch chain into the loop
    { cp: 0.8, d: 0 },
    { cp: 1.2, d: 0 },
    { cp: 12.4, d: 0 },  // switchback exit
    { cp: 14.4, d: 0 },
    { cp: 16.0, d: 0 },  // the summit — blind
    { cp: 19.5, d: 0 },  // descent
    { cp: 20.4, d: 0 },  // into the crossover (just before the fork)
    { cp: 21.4, d: 8 },  // FORK fast lane: pad chain down the inside (right) line
    { cp: 22.0, d: 8 },
    { cp: 22.6, d: 8 },
    { cp: 23.4, d: 0 },  // final corner exit
  ],
  // Route forks: a raised island splits the road into two committed lanes over
  // [from,to] (cp indices). `gap` is the island half-width; `fast` is the side
  // (+1 right / -1 left) that's shorter and carries the pad chain — the brave
  // line. The other side is longer and open — the safe line.
  splits: [
    // The flyover sweeper hooking home is a right-hander, so inside (right) is
    // the shorter line + boosted, but pinned against the island; outside (left)
    // is the safe long way round. Clear of the loop and the summit jump.
    { from: 20.9, to: 23.1, gap: 4.5, fast: 1 },
  ],
  features: [
    // Barrel roll the launch straight, straight into the loop (cp 2-8),
    // then a jump on the descent off the summit.
    { type: 'corkscrew', from: 0.4, to: 1.4, turns: 1, dir: 1 },
    { type: 'jump', cp: 18.3, gap: 20, lift: 11 },
  ],
};
