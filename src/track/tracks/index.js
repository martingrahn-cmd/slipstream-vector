// The track roster, in menu order: 4 worlds x 3 tracks, grouped by world.
import { SUNSET_CIRCUIT } from './sunsetCircuit.js';
import { MESA_RUN } from './mesaRun.js';
import { DUNE_DRIFT } from './duneDrift.js';
import { LAGOON_PASS } from './lagoonPass.js';
import { CORAL_KEYS } from './coralKeys.js';
import { BREAKER_BAY } from './breakerBay.js';
import { ORBITAL_RING } from './orbitalRing.js';
import { SKYLINE_RUSH } from './skylineRush.js';
import { GRID_LOCK } from './gridLock.js';
import { AURORA_PASS } from './auroraPass.js';
import { AVALANCHE_RUN } from './avalancheRun.js';
import { MOONLIT_MILE } from './moonlitMile.js';

export const TRACKS = [
  SUNSET_CIRCUIT,   //  0 desert
  MESA_RUN,         //  1
  DUNE_DRIFT,       //  2
  LAGOON_PASS,      //  3 tropic
  CORAL_KEYS,       //  4
  BREAKER_BAY,      //  5
  ORBITAL_RING,     //  6 city
  SKYLINE_RUSH,     //  7
  GRID_LOCK,        //  8
  AURORA_PASS,      //  9 frost
  AVALANCHE_RUN,    // 10
  MOONLIT_MILE,     // 11
];

// The championships: two 6-round cups over the roster (indices into TRACKS).
// VECTOR CUP is the classic calendar; AURORA CUP runs the newer circuits and
// finishes in FROSTFALL RIDGE under the northern lights.
export const CUPS = [
  { id: 'vector', name: 'VECTOR CUP', tracks: [0, 1, 3, 4, 6, 7] },
  { id: 'aurora', name: 'AURORA CUP', tracks: [2, 5, 8, 9, 10, 11] },
];
