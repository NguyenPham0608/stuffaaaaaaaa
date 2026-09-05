/**
 * Fixed-timestep game loop with render interpolation.
 * A scene is any object with update(dt) and render(ctx, alpha, view).
 */
export class Engine {
  constructor(canvas, { fixedDt = 1 / 120, maxFrameTime = 0.1 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fixedDt = fixedDt;
    this.maxFrameTime = maxFrameTime;
    this.maxStepsPerFrame = Math.ceil(maxFrameTime / fixedDt) + 1;

    this.scene = null;
    this.running = false;
    this.time = 0;              // simulated time (s)
    this.frame = 0;
    this.fps = 0;
    this.view = { width: 0, height: 0, dpr: 1 };

    this._acc = 0;
    this._last = 0;
    this._fpsAcc = 0;
    this._fpsCount = 0;
    this._raf = 0;
    this._tick = (t) => this._frame(t);

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    document.addEventListener('visibilitychange', () => { this._last = 0; this._acc = 0; });
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.view.width = w;
    this.view.height = h;
    this.view.dpr = dpr;
  }

  setScene(scene) {
    this.scene?.exit?.(this);
    this.scene = scene;
    scene.enter?.(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = 0;
    this._raf = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }

  /** Advance the simulation by exactly one fixed step (useful for tests/tools). */
  stepOnce() {
    this.scene?.update(this.fixedDt);
    this.time += this.fixedDt;
  }

  _frame(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._tick);

    if (!this._last) this._last = now;
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (dt > this.maxFrameTime) dt = this.maxFrameTime;
    if (dt < 0) dt = 0;

    this._fpsAcc += dt; this._fpsCount++;
    if (this._fpsAcc >= 0.5) { this.fps = Math.round(this._fpsCount / this._fpsAcc); this._fpsAcc = 0; this._fpsCount = 0; }

    this._acc += dt;
    let steps = 0;
    while (this._acc >= this.fixedDt && steps < this.maxStepsPerFrame) {
      this.scene?.update(this.fixedDt);
      this.time += this.fixedDt;
      this._acc -= this.fixedDt;
      steps++;
    }
    if (steps === this.maxStepsPerFrame) this._acc = 0;

    const alpha = this._acc / this.fixedDt;
    this.frame++;
    this.scene?.render(this.ctx, alpha, this.view);
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
  }
}
