// World 1, track 2: a fast flowing figure-8. Two open loops joined by a
// diagonal that crosses OVER the start straight — pure speed, few pinches.
export const MESA_RUN = {
  id: 'mesa-run',
  name: 'Mesa Run',
  world: 'desert',
  laps: 3,
  points: [
    { x: -300, y: 6, z: 0, width: 18 },   //  0 start/finish, heading east
    { x: -180, y: 4, z: 0, width: 18 },   //  1 |
    { x: -60, y: 3, z: 0, width: 18 },    //  2 | launch straight
    { x: 60, y: 4, z: -20, width: 16 },   //  3
    { x: 180, y: 8, z: -60, width: 15 },  //  4 right loop begins
    { x: 260, y: 12, z: -150, width: 15 },//  5 sweeping right
    { x: 280, y: 16, z: -260, width: 14 },//  6
    { x: 200, y: 18, z: -340, width: 14 },//  7 loop apex
    { x: 80, y: 14, z: -350, width: 15 }, //  8
    { x: -10, y: 10, z: -280, width: 15 },//  9 exiting north-west
    { x: -40, y: 8, z: -180, width: 14 }, // 10
    { x: 0, y: 12, z: -90, width: 14 },   // 11 climbing toward the crossover
    { x: 60, y: 16, z: 20, width: 14 },   // 12 FLYOVER above the launch straight
    { x: 90, y: 14, z: 130, width: 15 },  // 13 left loop begins
    { x: 60, y: 10, z: 240, width: 15 },  // 14
    { x: -40, y: 6, z: 300, width: 16 },  // 15
    { x: -160, y: 5, z: 310, width: 16 }, // 16 loop apex
    { x: -260, y: 6, z: 250, width: 17 }, // 17
    { x: -320, y: 6, z: 150, width: 17 }, // 18
    { x: -360, y: 6, z: 60, width: 18 },  // 19 final right onto the straight
  ],
  boostPads: [
    { cp: 0.5, d: 4 },   // launch chain on the right risk line
    { cp: 0.9, d: 4 },
    { cp: 1.3, d: 4 },
    { cp: 7.5, d: 0 },   // right loop exit
    { cp: 9.4, d: 0 },
    { cp: 12.0, d: 0 },  // top of the flyover
    { cp: 15.5, d: 0 },  // left loop
    { cp: 17.6, d: -3 }, // outer line through the long left
  ],
  features: [
    // Barrel-roll the launch straight — the road rolls a full turn under you.
    { type: 'corkscrew', from: 1.0, to: 2.1, turns: 1, dir: 1 },
    // ...then a jump right off the end of it, into the first sweep.
    { type: 'jump', cp: 2.5, gap: 20, lift: 11 },
  ],
};
