/**
 * Registry of surface materials. A Shape copies these properties at construction, so add
 * new materials here (or via registerMaterial) and reference them by name in level data.
 * Optional `draw(ctx, shape)` overrides the default rendering.
 */
export const Materials = {
  solid:  { name: 'solid',  label: 'Solid',   color: '#ffffff', friction: 1,    bounce: 0 },
  ice:    { name: 'ice',    label: 'Ice',     color: '#cdf3ff', friction: 0.12, bounce: 0 },
  bouncy: { name: 'bouncy', label: 'Bouncy',  color: '#c874e8', friction: 1,    bounce: 0.9 },
  oneway: { name: 'oneway', label: 'One-way', color: '#3fb95c', friction: 1,    bounce: 0, oneWay: true },
  hazard: { name: 'hazard', label: 'Hazard',  color: '#e11d48', friction: 1,    bounce: 0, hazard: true },
};

export function registerMaterial(name, def) {
  Materials[name] = { name, label: name, color: '#ffffff', friction: 1, bounce: 0, ...def };
  return Materials[name];
}
