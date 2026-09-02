// ALL tuning constants live here, in one exported object (spec §11.4).
//
// These values are owned by the human. Never edit a value here to make a test
// pass — if a test and a constant disagree, the test or the formula is wrong.
export const TUNING = {
  // wind
  WIND_BASE: 12,          // kt, tier 1 — the wind every other value scales from

  // kite
  BASE_SLEW: 90,          // deg/s at 12kt
  SLEW_WIND_SCALE: 40,
  OVERSHOOT_DEG: 8,
  OVERSHOOT_SETTLE: 0.2,  // s
  OVERSHOOT_MIN_SWEEP: 60, // deg of travel above which a sweep overshoots
  TENSION_SPEED_MIX: 0.6, // share of line tension that comes from speed, not window position

  // drive
  DRIVE_K: 12,
  DRIVE_SHAPE: 0.5,       // theta multiplier in driveFactor — sets where drive peaks
  LIFT_EXP: 1.5,          // exponent in liftFactor
  DRAG_K: 0.04,
  MAX_SPEED: 22,          // m/s at 35kt
  AIR_DRIVE_MIX: 0.35,    // share of the drive/drag balance that still applies airborne

  // load
  LOAD_RATE: 1.4,         // per second at max speed
  CARVE_DRAG_K: 0.04,     // extra drag per unit of load — at DRAG_K, a full edge doubles drag
  STALL_GRACE: 0.4,       // s
  STALL_SPEED_LOSS: 0.4,  // share of speed the edge catch takes away

  // pop
  POP_K: 9.5,
  FLAT_POP_CAP: 5.0,      // m
  GRAVITY: 9.81,
  FLOAT_K: 2.0,           // ~15% hangtime swing

  // kicker
  KICKER_WINDOW: 0.30,    // s
  BONUS_CHOP: 1.15,
  BONUS_WAVE: 1.60,
  BONUS_WAKE: 2.40,
  RAMP_CHOP: 0.3,         // m of ramp height (spec §4.1)
  RAMP_WAVE: 1.0,
  RAMP_WAKE: 1.8,
  WAVE_FACE_K: 5,         // m of face per sqrt(m) of ramp height — the slope the face launches off

  // landing
  CLEAN_BAND: [35, 75],   // deg
  SKETCHY_BAND: [20, 85],
  SOFT_LAND: 8,           // m/s descent
  HARD_LAND: 14,
  LAND_FORGIVE: 0.85,      // 0 = flat descent cap, 1 = same demand at every apex
  CLEAN_QUALITY: 1.0,     // landingQuality of a clean touchdown (spec §3.7)
  SKETCHY_QUALITY: 0.4,
  SKETCHY_SPEED_LOSS: 0.25, // share of speed a sketchy landing takes away
  LAND_RECOVER: 0.25,     // s, the landing beat before riding resumes
  WIPEOUT_RECOVER: 2.0,   // s, relaunch beat with the kite down (spec §7.2)

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
  CAM_DAMP: 8,            // 1/s, how fast the camera catches its altitude target
  ANCHOR_X: 0.2,          // rider screen position, fraction of width
  HORIZON_Y: 0.42,        // fraction of height
  WATERLINE_Y: 0.72,      // fraction of height, rider at altitude 0
  KITE_W: 90,             // px, span of the kite quad
  LINE_SAG: 44,           // px, control-point drop at zero tension
  LINE_TREMBLE: 3,        // px of tremble per unit of wind above tier 1
  LINE_TREMBLE_HZ: 13,    // tremble frequency
  WATER_BAND_M: 4,        // m between water texture streaks
  PARALLAX_FAR: 0.15,     // scroll rate of the far water band, x rider speed
  PARALLAX_MID: 0.45,
  PARALLAX_NEAR: 1.15,

  // feedback
  SHAKE_CLEAN: 3,         // px of screen shake on a clean landing
  SHAKE_SKETCHY: 9,
  SHAKE_WIPEOUT: 20,
  SHAKE_DECAY: 6,         // 1/s, how fast the shake dies away
  SPRAY_CLEAN: 26,        // spray particles thrown by a clean landing
  SPRAY_SKETCHY: 14,
  SPRAY_WIPEOUT: 44,
  FLASH_TIME: 0.9,        // s the landing verdict holds on screen
  SHADOW_FADE_M: 14,      // m of altitude over which the water shadow fades out

  // generation
  REACTION_MIN: 0.55,     // s
  WAVE_GAP_MIN: 55,       // m between one lip and the next
  WAVE_GAP_MAX: 140,
  WAVE_MIX_CHOP: 0.55,    // share of waves that are chop
  WAVE_MIX_WAVE: 0.35,    // share that are waves — boat wakes take the rest
  WAVE_LEAD: 2.5,         // s of warning a wave gets before its lip
}
