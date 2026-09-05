/** Uniform-grid broadphase for static rectangles ({x, y, w, h}). */
export class SpatialHash {
  constructor(cellSize = 64) {
    this.cellSize = cellSize;
    this._cells = new Map();
    this._stamp = 0;
  }

  _key(cx, cy) { return cx * 1048576 + cy; } // fine for |cx|,|cy| < 2^19

  _forCells(rect, fn) {
    const s = this.cellSize;
    const x0 = Math.floor(rect.x / s), y0 = Math.floor(rect.y / s);
    const x1 = Math.floor((rect.x + rect.w) / s), y1 = Math.floor((rect.y + rect.h) / s);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) fn(this._key(cx, cy));
  }

  insert(item) {
    this._forCells(item, (k) => {
      let cell = this._cells.get(k);
      if (!cell) { cell = []; this._cells.set(k, cell); }
      cell.push(item);
    });
  }

  remove(item) {
    this._forCells(item, (k) => {
      const cell = this._cells.get(k);
      if (!cell) return;
      const i = cell.indexOf(item);
      if (i >= 0) cell.splice(i, 1);
      if (cell.length === 0) this._cells.delete(k);
    });
  }

  clear() { this._cells.clear(); }

  /** Unique items whose cells intersect the query rect. Reuses `out`. */
  query(x, y, w, h, out = []) {
    out.length = 0;
    const stamp = ++this._stamp;
    this._forCells({ x, y, w, h }, (k) => {
      const cell = this._cells.get(k);
      if (!cell) return;
      for (const item of cell) {
        if (item._hashStamp === stamp) continue;
        item._hashStamp = stamp;
        out.push(item);
      }
    });
    return out;
  }
}
