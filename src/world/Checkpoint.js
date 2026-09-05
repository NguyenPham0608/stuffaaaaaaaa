let nextId = 1;

/**
 * A flag the player respawns at. Touching one makes it the active respawn point for the rest
 * of the run; `y` is the ground line it stands on, like a switch.
 */
export class Checkpoint {
  constructor({ x = 0, y = 0, w = 16, h = 46 } = {}) {
    this.id = nextId++;
    this.x = x; this.y = y;
    this.w = w; this.h = h;
    this.reached = false;
    this.raise = 0;                  // 0..1 flag-raising animation
  }

  /** The box the player has to touch, covering the whole pole. */
  get rect() { return { x: this.x - this.w / 2, y: this.y - this.h, w: this.w, h: this.h }; }

  /** Where the player's centre goes when respawning here. */
  spawnPoint(radius) { return { x: this.x, y: this.y - radius - 1 }; }

  reset() { this.reached = false; this.raise = 0; }

  toJSON() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
}
