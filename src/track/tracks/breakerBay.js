// World 2 (Palm Coast), track 3: the MARINA. Tight and technical where the
// other two coast tracks flow — quay chicanes, a corkscrew along the
// breakwater, a split around the lighthouse islet, a jump across the marina
// inlet and a proper harbour hairpin. No loop on purpose: this one is about
// braking points, not spectacle.
export const BREAKER_BAY = {
  id: 'breaker-bay',
  name: 'Breaker Bay',
  world: 'tropic',
  laps: 3,
  points: [
    { x: 0, y: 2, z: 260, width: 14 },     //  0 start on the boardwalk
    { x: 0, y: 2, z: 120, width: 13 },     //  1 | pier straight
    { x: -10, y: 2, z: -10, width: 14 },   //  2 |
    { x: -40, y: 3, z: -140, width: 12 },  //  3 harbour turn in
    { x: -120, y: 3, z: -220, width: 9 },  //  4 marina chicane L — PINCH
    { x: -210, y: 3, z: -190, width: 9 },  //  5 marina chicane R — PINCH
    { x: -290, y: 4, z: -120, width: 11 }, //  6 quay run
    { x: -360, y: 4, z: -20, width: 12 },  //  7 the breakwater (corkscrew)
    { x: -390, y: 5, z: 100, width: 13 },  //  8 rolling along the wall
    { x: -360, y: 5, z: 220, width: 12 },  //  9 rollout
    { x: -290, y: 4, z: 310, width: 10 },  // 10 lighthouse islet approach
    { x: -190, y: 4, z: 370, width: 17 },  // 11 SPLIT around the islet
    { x: -80, y: 4, z: 390, width: 17 },   // 12 lanes parallel
    { x: 30, y: 4, z: 370, width: 13 },    // 13 merge
    { x: 130, y: 4, z: 320, width: 11 },   // 14 resort esses in
    { x: 200, y: 5, z: 250, width: 8 },    // 15 esses — PINCH
    { x: 260, y: 5, z: 170, width: 8 },    // 16 esses — PINCH
    { x: 300, y: 4, z: 70, width: 11 },    // 17 inlet approach
    { x: 320, y: 5, z: -40, width: 13 },   // 18 JUMP the marina inlet
    { x: 310, y: 4, z: -160, width: 13 },  // 19 landing on the far quay
    { x: 260, y: 3, z: -260, width: 10 },  // 20 harbour end
    { x: 180, y: 2, z: -310, width: 7 },   // 21 harbour hairpin — TIGHT
    { x: 100, y: 2, z: -260, width: 9 },   // 22 exit
    { x: 85, y: 2, z: -160, width: 11 },   // 23 back along the shore, EAST of the pier
    { x: 80, y: 2, z: 0, width: 12 },      // 24 |
    { x: 74, y: 2, z: 170, width: 12 },    // 25 shore run, climbing past the line
    { x: 56, y: 2, z: 335, width: 13 },    // 26 wide arc north of it
    { x: 22, y: 2, z: 392, width: 14 },    // 27 monotonic fall onto the boardwalk
  ],
  boostPads: [
    { cp: 0.6, d: -4 },   // boardwalk chain
    { cp: 1.2, d: -4 },
    { cp: 6.3, d: 0 },    // quay run
    { cp: 9.4, d: 0 },    // off the breakwater
    { cp: 10.9, d: 8 },   // SPLIT fast lane past the lighthouse
    { cp: 11.6, d: 8 },
    { cp: 12.3, d: 8 },
    { cp: 16.5, d: 0 },   // esses exit
    { cp: 19.3, d: 0 },   // inlet landing
    { cp: 22.4, d: 0 },   // hairpin exit
    { cp: 24.6, d: 3 },   // shore chain home
    { cp: 25.4, d: 3 },
  ],
  weaponPads: [
    { cp: 2.6, d: -3 },
    { cp: 9.0, d: 3 },
    { cp: 13.5, d: -3 },
    { cp: 19.8, d: 3 },
    { cp: 24.0, d: -3 },
  ],
  splits: [
    { from: 10.5, to: 12.7, gap: 4.5, fast: 1 },  // the lighthouse islet
  ],
  features: [
    { type: 'corkscrew', from: 7.2, to: 8.6, turns: 1, dir: -1 },
    { type: 'jump', cp: 17.6, gap: 18, lift: 9 },
  ],
};
