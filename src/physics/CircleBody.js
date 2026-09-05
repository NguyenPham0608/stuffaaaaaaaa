import { Vec2 } from '../math/MathUtil.js';

/**
 * A dynamic circle. Position/velocity are integrated by PhysicsWorld; contact
 * information is filled in each step for controllers to read.
 */
export class CircleBody {
  constructor({ x = 0, y = 0, radius = 12 } = {}) {
    this.pos = new Vec2(x, y);
    this.prevPos = new Vec2(x, y);
    this.vel = new Vec2(0, 0);
    this.radius = radius;

    /** Timer; while > 0 the body falls through one-way platforms. */
    this.dropThrough = 0;

    /** Classified contacts (null or {wall, nx, ny}). Refreshed every step. */
    this.contacts = { ground: null, ceiling: null, left: null, right: null };
    /** Raw contacts within skin distance, refreshed every step. */
    this.senseContacts = [];
    /** Every wall the body touched during the last step (post-solve and sensing). */
    this.touched = new Set();
    /** First hazard wall touched during the last step, if any. */
    this.hazard = null;
    /** Set when a bouncy surface reflected the body this step: {wall, nx, ny, speed}. */
    this.bounced = null;
    /** Set while shoving a dynamic object sideways: {dir, factor} caps horizontal speed (see GameScene). */
    this.push = null;
  }

  get onGround() { return this.contacts.ground !== null; }
  get groundWall() { return this.contacts.ground?.wall ?? null; }

  teleport(x, y) {
    this.pos.set(x, y);
    this.prevPos.set(x, y);
    this.vel.set(0, 0);
    this.contacts.ground = this.contacts.ceiling = this.contacts.left = this.contacts.right = null;
    this.senseContacts.length = 0;
    this.touched.clear();
    this.hazard = null;
    this.bounced = null;
    this.push = null;
  }
}
