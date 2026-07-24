// World 4 (FROSTFALL RIDGE), track 3: the FLOW. A fast open glide across the
// moonlit tundra — long linked sweepers under the aurora, a loop out on the
// flats, a corkscrew through the pine belt and one split around a frozen
// erratic boulder. The world's Sunset Circuit: rhythm, not violence.
export const MOONLIT_MILE = {
  id: 'moonlit-mile',
  name: 'Moonlit Mile',
  world: 'frost',
  laps: 3,
  points: [
    { x: 0, y: 3, z: 320, width: 16 },     //  0 start/finish
    { x: 0, y: 3, z: 170, width: 15 },     //  1 | tundra straight (chain)
    { x: 10, y: 3, z: 20, width: 16 },     //  2 | flat out (LOOP out here)
    { x: 40, y: 4, z: -130, width: 15 },   //  3 |
    { x: 110, y: 5, z: -250, width: 14 },  //  4 sweeper 1 in
    { x: 220, y: 6, z: -320, width: 13 },  //  5 linked left
    { x: 340, y: 6, z: -330, width: 13 },  //  6 linked right
    { x: 440, y: 5, z: -270, width: 14 },  //  7 opening out
    { x: 490, y: 4, z: -150, width: 16 },  //  8 east straight
    { x: 500, y: 4, z: -10, width: 17 },   //  9 | (split ahead)
    { x: 480, y: 4, z: 130, width: 18 },   // 10 SPLIT around the erratic
    { x: 430, y: 5, z: 260, width: 18 },   // 11 lanes glide in parallel
    { x: 350, y: 6, z: 360, width: 15 },   // 12 merge
    { x: 240, y: 7, z: 420, width: 13 },   // 13 north sweeper
    { x: 120, y: 8, z: 440, width: 12 },   // 14 pine belt in (corkscrew)
    { x: 0, y: 8, z: 420, width: 12 },     // 15 rolling through the pines
    { x: -110, y: 7, z: 380, width: 13 },  // 16 rollout
    { x: -220, y: 6, z: 330, width: 11 },  // 17 tightening left
    { x: -300, y: 5, z: 240, width: 9 },   // 18 the only pinch — commit
    { x: -340, y: 4, z: 130, width: 11 },  // 19 exit swings wide
    { x: -350, y: 3, z: 10, width: 13 },   // 20 west straight
    { x: -320, y: 3, z: -110, width: 14 }, // 21 |
    { x: -250, y: 3, z: -190, width: 12 }, // 22 low sweep home
    { x: -160, y: 3, z: -200, width: 13 }, // 23
    { x: -150, y: 3, z: 0, width: 14 },    // 24 the west run — well clear of the straight
    { x: -140, y: 3, z: 200, width: 15 },  // 25 | climbing PAST the line
    { x: -105, y: 3, z: 360, width: 15 },  // 26 wide arc north of it
    { x: -45, y: 3, z: 415, width: 16 },   // 27 …and a monotonic fall onto the grid
  ],
  boostPads: [
    { cp: 0.7, d: -4 },   // start chain by the left wall
    { cp: 1.3, d: -4 },
    { cp: 1.9, d: -4 },
    { cp: 7.4, d: 0 },    // sweeper exit
    { cp: 9.6, d: 8 },    // SPLIT fast lane past the erratic
    { cp: 10.4, d: 8 },
    { cp: 11.2, d: 8 },
    { cp: 13.4, d: 0 },   // north sweeper
    { cp: 16.4, d: 0 },   // out of the pines
    { cp: 19.4, d: 0 },   // pinch exit
    { cp: 22.4, d: 0 },   // low sweep
    { cp: 25.2, d: 3 },   // run home
    { cp: 26.0, d: 3 },
  ],
  weaponPads: [
    { cp: 3.3, d: 3 },
    { cp: 8.4, d: -3 },
    { cp: 12.6, d: 3 },
    { cp: 20.5, d: -3 },
    { cp: 24.5, d: 3 },
  ],
  splits: [
    { from: 9.4, to: 11.7, gap: 4.5, fast: 1 },   // the frozen erratic boulder
  ],
  features: [
    { type: 'loop', cp: 2, dir: 1 },                            // out on the flats
    { type: 'corkscrew', from: 14.2, to: 15.6, turns: 1, dir: -1 }, // through the pines
  ],
};
