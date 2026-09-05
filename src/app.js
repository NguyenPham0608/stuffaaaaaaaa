import { CONFIG } from './config.js';
import { Engine } from './core/Engine.js';
import { Input } from './core/Input.js';
import { Level } from './world/Level.js';
import { GameScene } from './scenes/GameScene.js';
import { LEVEL_1 } from './levels/level1.js';
import { createEditor, loadSavedLevel } from './editor/Editor.js';

const MODE_KEY = 'ballplatformer.mode';
const canvas = document.getElementById('game');
const sidebar = document.getElementById('sidebar');
const statusEl = document.getElementById('status');
const helpEl = document.getElementById('modehelp');
const modeButtons = [...document.querySelectorAll('#modebar .mode')];

/** Play mode uses the editor's saved level when it is playable, else the built-in one. */
function pickPlayLevel() {
  const saved = loadSavedLevel();
  if (saved) {
    try {
      const level = Level.fromJSON(saved, { name: 'custom' });
      if (level.playable) return level;
    } catch { /* fall through to the built-in level */ }
  }
  return Level.fromJSON(LEVEL_1, { name: 'level1' });
}

const MODES = {
  play: {
    help: '← → move · Space/Z jump · X carry · ↓+jump drop through · R reset · ` debug',
    start() {
      const engine = new Engine(canvas, CONFIG.physics);
      const input = new Input(window);
      const scene = new GameScene({ input, level: pickPlayLevel(), config: CONFIG });
      engine.setScene(scene);
      engine.start();
      window.game = { engine, input, scene, config: CONFIG, Level };
      return { stop() { engine.destroy(); input.destroy(); window.game = null; } };
    },
  },
  editor: {
    help: 'drag empty space to pan · pick a material then drag to draw · drag shapes and nodes · click a midpoint to add a node, drag it to curve',
    start() {
      const editor = createEditor({ canvas, statusEl });
      window.editor = editor;
      return { stop() { editor.stop(); window.editor = null; } };
    },
  },
};

let current = null;
let currentName = null;

export function setMode(name) {
  if (!MODES[name] || name === currentName) return;
  current?.stop();
  currentName = name;
  sidebar.hidden = name !== 'editor';
  statusEl.hidden = name !== 'editor';
  helpEl.textContent = MODES[name].help;
  for (const b of modeButtons) b.classList.toggle('active', b.dataset.mode === name);
  current = MODES[name].start();
  try { localStorage.setItem(MODE_KEY, name); } catch { /* ignore */ }
}

for (const b of modeButtons) {
  b.addEventListener('click', () => { setMode(b.dataset.mode); b.blur(); });
}

let saved = null;
try { saved = localStorage.getItem(MODE_KEY); } catch { /* ignore */ }
setMode(MODES[saved] ? saved : 'play');

window.app = { setMode, get mode() { return currentName; } };
