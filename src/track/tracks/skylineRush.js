// World 3, track 2: the mountain stage of the city — launch straight with a
// full F-Zero LOOP (cp 2-8), switchbacks up between the towers to a 44m
// summit, then a dive that crosses OVER the straight on the way home.
export const SKYLINE_RUSH = {
  id: 'skyline-rush',
  name: 'Skyline Rush',
  world: 'city',
  laps: 3,
  points: [
    { x: 0, y: 4, z: 250, width: 16 },    //  0 start/finish, heading north
    { x: 0, y: 3, z: 120, width: 16 },    //  1 launch straight
    { x: -16, y: 3, z: 60, width: 13 },   //  2 LOOP entry (bottom)
    { x: -10.7, y: 23, z: 25, width: 13 },//  3 climbing the face
    { x: -5.3, y: 63, z: 25, width: 13 }, //  4
    { x: 0, y: 83, z: 60, width: 13 },    //  5 the top, over the launch straight
    { x: 5.3, y: 63, z: 95, width: 13 },  //  6
    { x: 10.7, y: 23, z: 95, width: 13 }, //  7
    { x: 16, y: 3, z: 60, width: 13 },    //  8 LOOP exit (bottom, 32m over)
    { x: 0, y: 4, z: -10, width: 16 },    //  9 straight resumes
    { x: 30, y: 8, z: -140, width: 15 },  // 10 climb begins
    { x: 130, y: 14, z: -220, width: 14 },// 11 right sweep up the flank
    { x: 250, y: 20, z: -180, width: 13 },// 12 switchback right
    { x: 290, y: 26, z: -70, width: 13 }, // 13
    { x: 230, y: 32, z: 30, width: 12 },  // 14 climbing hard, narrow
    { x: 120, y: 38, z: 60, width: 12 },  // 15 switchback left
    { x: 40, y: 44, z: 0, width: 12 },    // 16 SUMMIT
    { x: -60, y: 40, z: -60, width: 13 }, // 17 over the top
    { x: -160, y: 30, z: -20, width: 14 },// 18 descent
    { x: -200, y: 20, z: 90, width: 14 }, // 19 diving left
    { x: -120, y: 16, z: 120, width: 15 },// 20 lining up the crossover
    { x: 20, y: 13, z: 140, width: 15 },  // 21 FLYOVER above the launch straight
    { x: 120, y: 6, z: 220, width: 15 },  // 22 down and hooking back
    { x: 80, y: 4, z: 330, width: 16 },   // 23
    { x: -10, y: 4, z: 350, width: 16 },  // 24 final corner onto the line
  ],
  boostPads: [
    { cp: 0.4, d: 0 },   // launch chain into the loop
    { cp: 0.8, d: 0 },
    { cp: 1.2, d: 0 },
    { cp: 12.4, d: 0 },  // switchback exit
    { cp: 14.4, d: 0 },
    { cp: 16.0, d: 0 },  // the summit — blind
    { cp: 19.5, d: 0 },  // descent
    { cp: 21.1, d: 0 },  // top of the crossover
    { cp: 23.4, d: 0 },  // final corner exit
  ],
  features: [
    // Barrel roll the launch straight, straight into the loop (cp 2-8),
    // then a jump on the descent off the summit.
    { type: 'corkscrew', from: 0.4, to: 1.4, turns: 1, dir: 1 },
    { type: 'jump', cp: 18.3, gap: 20, lift: 11 },
  ],
};
