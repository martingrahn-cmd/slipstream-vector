// The track roster, in menu order: 3 worlds x 2 tracks.
import { SUNSET_CIRCUIT } from './sunsetCircuit.js';
import { MESA_RUN } from './mesaRun.js';
import { LAGOON_PASS } from './lagoonPass.js';
import { CORAL_KEYS } from './coralKeys.js';
import { ORBITAL_RING } from './orbitalRing.js';
import { SKYLINE_RUSH } from './skylineRush.js';
// FROSTFALL RIDGE (world 4) is built but NOT yet in the roster — Aurora Pass
// goes live with the full content block (12 tracks -> two 6-round cups), so
// the championship length never changes under a live player's saved cup.
// To preview locally: import AURORA_PASS / AVALANCHE_RUN and append them.
export const TRACKS = [
  SUNSET_CIRCUIT,
  MESA_RUN,
  LAGOON_PASS,
  CORAL_KEYS,
  ORBITAL_RING,
  SKYLINE_RUSH,
];
