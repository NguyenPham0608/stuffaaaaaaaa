// All engine tunables live here. Anything gameplay-feel related should be changed
// in this file rather than inside the systems that consume it.
export const CONFIG = {
  tileSize: 32,              // object sizes and the ASCII importer are measured in tiles

  physics: {
    fixedDt: 1 / 120,        // simulation step (s)
    maxFrameTime: 0.1,       // clamp on frame delta to avoid spiral of death (s)
    skin: 0.75,              // contact sensing distance beyond the radius (px)
    maxSubstepMove: 0.5,     // max distance per substep as a fraction of radius
    maxSubsteps: 64,         // speeds beyond radius*maxSubstepMove*maxSubsteps/dt are clamped
    solverIterations: 4,     // overlap resolution passes per substep
    groundNormalY: -0.65,    // contact normal.y <= this counts as ground (~49 degree slopes)
    ceilingNormalY: 0.65,    // contact normal.y >= this counts as ceiling
    wallNormalX: 0.75,       // |normal.x| >= this counts as wall (when not ground)
    gripNormalY: -0.9,       // landings on ground this flat don't convert fall speed into sideways speed
    cornerCorrection: 8,     // px of horizontal nudge allowed when clipping a ceiling corner
    oneWayTolerance: 2,      // px the ball may already be below a one-way top and still land
    minBounceSpeed: 10,      // impact speed needed for a bouncy surface to bounce (px/s); below
                             //   gravity's per-step nudge, so a pad relaunches you even at rest
    minBounceLaunch: 400,    // a bouncy surface always launches at least this fast (px/s)
  },

  player: {
    radius: 13,

    // Horizontal movement (px/s, px/s^2)
    moveSpeed: 340,
    groundAccel: 2800,
    groundDecel: 420,        // coasting to a stop takes ~0.8s from full speed
    airAccel: 2000,
    airDecel: 200,
    turnBoost: 1.5,          // accel multiplier when reversing direction
    stickSpeed: 25,          // below this speed with no input on the ground, the ball comes fully to rest
    leaveGroundSpeed: 30,    // moving away from the ground faster than this counts as airborne (px/s)
    stickMaxSlope: 0.97,     // ground normal.y magnitude above which even slippery ground counts as flat
    slideFactor: 1,          // how strongly gravity pulls the ball down slippery slopes

    // Vertical movement
    gravity: 1450,
    fallGravityMult: 1.4,    // gravity multiplier while falling
    apexThreshold: 50,       // |vy| below this (while airborne) is the apex
    apexGravityMult: 0.6,    // gravity multiplier at the apex (hang time)
    maxFallSpeed: 900,

    // Jumping
    jumpSpeed: 640,
    jumpCutMult: 0.45,       // vy multiplier when jump is released early
    jumpMinTime: 0.05,       // jump can't be cut before this much time has elapsed
    coyoteTime: 0.1,
    jumpBufferTime: 0.12,
    bounceHoldMult: 1.5,     // bounce-pad launch multiplier while the jump key is held

    // One-way platforms
    dropThroughTime: 0.2,

    // Visual
    spinDamping: 1.5,        // angular velocity damping while airborne
  },

  // Dynamic objects (crates, balls) and how the player couples to them.
  rigid: {
    gravity: 1600,
    iterations: 12,
    playerMass: 5,           // vs. crate ~1.3, heavy crate ~4, ball ~0.9
    playerFriction: 0.6,
    playerRestitution: 0,
    fixedDt: 1 / 120,
    pushMinFactor: 0.5,      // speed factor while pushing, playerMass/(playerMass+objectMass) floored at this
  },

  // Switches, powered doors, transport tubes and the carry mechanic.
  logic: {
    switchReach: 16,         // px above a plate that a body must reach into to press it
    switchSpring: 22,        // how fast a plate squashes down and springs back
    checkpointSpring: 12,    // how fast a checkpoint flag runs up its pole
    doorDuration: 0.5,       // seconds for a powered shape to travel its full `move`
    tubeSpeed: 520,          // px/s an object travels inside a tube
    tubeExitSpeed: 400,      // px/s an object is launched at when it leaves a tube
    tubeEnterSpeed: 25,      // minimum speed toward a mouth needed to be swallowed
    tubeCooldown: 0.35,      // s after leaving a tube before it can swallow the same thing again
    tubeExitClear: 6,        // px past the mouth a body is placed on the way out
    carryRange: 14,          // px of reach beyond the player's radius when grabbing
    carryGap: 1,             // px between the player and the object it carries
    carryAttach: 0.1,        // s a freshly grabbed object takes to slide onto the hold point
    carryUpright: 18,        // rate a held object levels out to the nearest quarter turn
    carryThrow: 1,           // fraction of the player's velocity handed over on release
    carrySettleIters: 4,     // passes pushing a held object (and the player) out of walls
  },

  // How level geometry is finished for play (see world/Rounding.js).
  terrain: {
    cornerRadius: 12,        // fillet on the outer corners of the merged geometry (px); 0 disables
    cornerMinAngle: 8,       // bends gentler than this (degrees) are left alone, so curves stay curves
  },

  camera: {
    smoothingX: 4,           // higher = snappier follow, lower = more eased
    smoothingY: 2.6,         // vertical lags a little behind horizontal so jumps don't jolt the view
    lookAheadX: 0.16,        // seconds of horizontal velocity to look ahead
    lookAheadY: 0.08,
    zoom: 1,
  },

  render: {
    background: '#92cdec',
    gridSpacing: 32,
    gridColor: 'rgba(20,45,80,0.06)',
    gridMajorColor: 'rgba(20,45,80,0.13)',
    outlineColor: '#173a5e',        // objects only; level geometry is drawn as flat fills
    outlineWidth: 2,
    checkpointOn: '#ef7215',
    checkpointOff: 'rgba(255,255,255,0.8)',
    tubeWall: 'rgba(255,255,255,0.9)',
    tubeGlass: 'rgba(255,255,255,0.16)',
    ballColor: '#ef7215',
    ballMark: 'rgba(0,0,0,0.4)',    // spin indicator so rolling reads
  },

  editor: {
    gridSize: 16,            // snap grid (px)
    handleRadius: 6,         // node handle size (screen px)
    zoomSpeed: 0.0012,       // zoom factor per wheel delta unit (exp scale)
    godSpeed: 900,           // px/s the god-mode player flies (px/s), x2.5 while holding shift
    godFollow: 7,            // how tightly the camera trails the god-mode player
  },

  debug: {
    enabled: false,
  },
};
