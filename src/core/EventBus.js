/** Minimal synchronous pub/sub. Systems talk to each other through this instead of direct references. */
export class EventBus {
  constructor() { this._listeners = new Map(); }

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(fn);
    return () => this.off(event, fn);
  }

  once(event, fn) {
    const off = this.on(event, (...args) => { off(); fn(...args); });
    return off;
  }

  off(event, fn) { this._listeners.get(event)?.delete(fn); }

  emit(event, payload) {
    const set = this._listeners.get(event);
    if (!set) return;
    for (const fn of [...set]) fn(payload);
  }
}
