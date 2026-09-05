/**
 * A pressure plate. It powers every shape whose `channel` matches while something is
 * standing on it. `accepts` filters what counts: 'any', 'player', 'box' (crate or heavy
 * crate) or 'ball' (the object ball, not the player).
 */
export const SWITCH_ACCEPTS = {
  any:    { label: 'Any',    color: '#ffffff' },
  player: { label: 'Player', color: '#ef7215' },
  box:    { label: 'Box',    color: '#e0b483' },
  ball:   { label: 'Ball',   color: '#2f8fc9' },
};

let nextId = 1;

export class Switch {
  constructor({ x = 0, y = 0, w = 48, h = 10, channel = 'a', accepts = 'any', latch = false } = {}) {
    if (!SWITCH_ACCEPTS[accepts]) accepts = 'any';
    this.id = nextId++;
    this.x = x; this.y = y;          // where the plate meets the ground it stands on
    this.w = w; this.h = h;          // the plate sits on top, spanning y - h .. y
    /** Any string; shapes with the same channel are powered together. */
    this.channel = String(channel || 'a');
    this.accepts = accepts;
    /** One-time: once pressed it stays pressed until the level resets. */
    this.latch = !!latch;
    this.latched = false;
    this.active = false;
    this.press = 0;                  // 0..1 visual depression
  }

  reset() { this.active = false; this.latched = false; this.press = 0; }

  get color() { return SWITCH_ACCEPTS[this.accepts].color; }

  /** Plate body, in world space: resting on the ground, never below it. */
  get rect() { return { x: this.x - this.w / 2, y: this.y - this.h, w: this.w, h: this.h }; }

  /** Region above the ground line that a body has to occupy to press the plate. */
  trigger(reach) { return { x: this.x - this.w / 2, y: this.y - this.h - reach, w: this.w, h: this.h + reach }; }

  /** Whether `kind` ('player', 'crate', 'heavy', 'ball') may press this switch. */
  takes(kind) {
    switch (this.accepts) {
      case 'player': return kind === 'player';
      case 'box': return kind === 'crate' || kind === 'heavy';
      case 'ball': return kind === 'ball';
      default: return true;
    }
  }

  toJSON() {
    const out = { x: this.x, y: this.y, w: this.w, h: this.h, channel: this.channel, accepts: this.accepts };
    if (this.latch) out.latch = true;
    return out;
  }
}
