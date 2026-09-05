/**
 * Action-based keyboard input. Edge state (justPressed/justReleased) is latched between
 * calls to poll(), so call poll() exactly once per simulation step: the first step of a
 * frame sees the edge, later steps in the same frame don't.
 */
export const DEFAULT_BINDINGS = {
  left:  ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up:    ['ArrowUp', 'KeyW'],
  down:  ['ArrowDown', 'KeyS'],
  jump:  ['Space', 'KeyZ', 'KeyK', 'ArrowUp', 'KeyW'],
  reset: ['KeyR'],
  debug: ['Backquote', 'F3'],
};

export class Input {
  constructor(target = window, bindings = DEFAULT_BINDINGS) {
    this.bindings = bindings;
    this._down = new Set();
    this._pendingPressed = new Set();
    this._pendingReleased = new Set();
    this._pressed = new Set();
    this._released = new Set();
    this._boundCodes = new Set(Object.values(bindings).flat());

    this._onKeyDown = (e) => {
      if (!this._boundCodes.has(e.code)) return;
      e.preventDefault();
      if (e.repeat) return;
      this._down.add(e.code);
      this._pendingPressed.add(e.code);
    };
    this._onKeyUp = (e) => {
      if (!this._boundCodes.has(e.code)) return;
      e.preventDefault();
      this._down.delete(e.code);
      this._pendingReleased.add(e.code);
    };
    this._onBlur = () => {
      for (const code of this._down) this._pendingReleased.add(code);
      this._down.clear();
    };

    target.addEventListener('keydown', this._onKeyDown);
    target.addEventListener('keyup', this._onKeyUp);
    target.addEventListener('blur', this._onBlur);
    this._target = target;
  }

  /** Latch edges for the upcoming simulation step. */
  poll() {
    const p = this._pressed; p.clear();
    for (const c of this._pendingPressed) p.add(c);
    this._pendingPressed.clear();
    const r = this._released; r.clear();
    for (const c of this._pendingReleased) r.add(c);
    this._pendingReleased.clear();
  }

  isDown(action) { return this._any(action, this._down); }
  justPressed(action) { return this._any(action, this._pressed); }
  justReleased(action) { return this._any(action, this._released); }

  /** -1, 0 or 1 from a pair of actions. */
  axis(negAction, posAction) {
    return (this.isDown(posAction) ? 1 : 0) - (this.isDown(negAction) ? 1 : 0);
  }

  _any(action, set) {
    const codes = this.bindings[action];
    if (!codes) return false;
    for (const c of codes) if (set.has(c)) return true;
    return false;
  }

  destroy() {
    this._target.removeEventListener('keydown', this._onKeyDown);
    this._target.removeEventListener('keyup', this._onKeyUp);
    this._target.removeEventListener('blur', this._onBlur);
  }
}
