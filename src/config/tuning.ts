// ALL tuning constants live here, in one exported object (spec §11.4).
//
// These values are owned by the human. Never edit a value here to make a test
// pass — if a test and a constant disagree, the test or the formula is wrong.
export const TUNING = {
  // kite
  BASE_SLEW: 90,          // deg/s at 12kt
  SLEW_WIND_SCALE: 40,
  OVERSHOOT_DEG: 8,
  OVERSHOOT_SETTLE: 0.2,  // s

  // drive
  DRIVE_K: 12,
  DRAG_K: 0.04,
  MAX_SPEED: 22,          // m/s at 35kt

  // load
  LOAD_RATE: 1.4,         // per second at max speed
  STALL_GRACE: 0.4,       // s

  // pop
  POP_K: 9.5,
  FLAT_POP_CAP: 5.0,      // m
  GRAVITY: 9.81,
  FLOAT_K: 1.6,           // ~15% hangtime swing

  // kicker
  KICKER_WINDOW: 0.30,    // s
  BONUS_CHOP: 1.15,
  BONUS_WAVE: 1.60,
  BONUS_WAKE: 2.40,

  // landing
  CLEAN_BAND: [35, 75],   // deg
  SKETCHY_BAND: [20, 85],
  SOFT_LAND: 8,           // m/s descent
  HARD_LAND: 14,

  // scoring
  HEIGHT_EXP: 1.5,
  HEIGHT_K: 10,
  DIST_PER_M: 1,
  COMBO_CAP: 10,
  COMBO_DECAY_M: 150,
  CLEARANCE_M: 0.75,

  // render
  WORLD_SCALE: 26,        // px per metre
  LINE_RADIUS: 264,       // px, compressed
  RIDER_H: 48,            // px
  CAM_ALT_FOLLOW: 0.6,

  // generation
  REACTION_MIN: 0.55,     // s
}
