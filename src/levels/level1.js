import { Level } from '../world/Level.js';

// The sample level starts life as tiles (legend: # solid, ~ ice, B bouncy, - one-way,
// ^ hazard, P spawn, c crate, h heavy crate, o ball) and gets a few free-form slopes
// and curves added on top. Levels made in the editor are plain JSON like `LEVEL_1`.
const TILES = `
############################################################################
#                                                                          #
#                                                                          #
#                                  ##                                      #
#                                  ##          ####                        #
#                    ####          ##                       ####           #
#   P         o                    ##      c                               #
#  ####      ---     ####          ##      ##                              #
#                                  ##                   ~~~~~~   ##        #
#          ##        ####          ##   ---        ##                      #
#                                  ##                         #  #   ##    #
#  ~~~~~~        ##  ####          ##  ##      co             #  #         #
#                                  ##         ####            #  #    ###  #
#                    ####     ###  ##                         #  #         #
#          ####                    ##               ###       #  #         #
#                     ---          ##       ##                #  #  ##     #
#   ##  c                          ##                 BB     c#  #         #
#     cc   BBB   ###  o^^^^^  ^^^^^##^^^^    hc    ^^^^^^^^^  #  #       ###
############################################################################
`;

// Headroom above the tiled layout, so the camera has somewhere to scroll vertically.
const SKY_ROWS = 14;
const rows = TILES.replace(/^\n+|\n+$/g, '').split('\n');
const sky = '#' + ' '.repeat(rows[0].length - 2) + '#';
const base = Level.fromAscii([rows[0], ...Array(SKY_ROWS).fill(sky), ...rows.slice(1)],
  { tileSize: 32, name: 'LEVEL_1' }).toJSON();

// The free-form pieces sit on the floor, so they are placed relative to the level's bottom.
const B = base.height;
base.shapes.push(
  // ramp up to the ledge left of the spawn pit
  { type: 'solid', nodes: [{ x: 32, y: B }, { x: 128, y: B - 64 }, { x: 128, y: B }] },
  // rolling hill on the right
  { type: 'solid', nodes: [
    { x: 2112, y: B, cx: 2150, cy: B - 88 }, { x: 2224, y: B - 80, cx: 2300, cy: B - 80 }, { x: 2336, y: B },
  ] },
  // icy half-pipe
  { type: 'ice', nodes: [
    { x: 1328, y: B }, { x: 1328, y: B - 108, cx: 1360, cy: B }, { x: 1440, y: B },
  ] },
);

// ---------------------------------------------------------------------------
// A demo of the logic elements, laid out in the empty sky above the tiled level.
// Ride the tube up, put the crate on the box switch to raise the wall and the ball on
// the ball switch to raise the bridge, then take the second tube back down.
const rect = (x, y, w, h, extra = {}) => ({
  type: 'solid', nodes: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], ...extra,
});
const LEDGE = 432;               // top surface of the sky ledge
const STAND = LEDGE - 13;        // where the player's centre sits on it

base.shapes.push(
  rect(224, 672, 130, 32),                    // walkway from the spawn ledge to the first tube
  rect(980, LEDGE, 550, 32),                  // sky ledge, left half
  rect(1630, LEDGE, 120, 32),                 // sky ledge, right half (the gap needs the bridge)
  rect(1430, LEDGE - 160, 60, 160, { channel: 'a', move: { dx: 0, dy: -176, duration: 0.5 } }),
  rect(1530, LEDGE + 88, 100, 24, { channel: 'b', move: { dx: 0, dy: -88, duration: 0.5 } }),
);

base.switches.push(
  { x: 1140, y: LEDGE, channel: 'a', accepts: 'box' },
  { x: 1330, y: LEDGE, channel: 'b', accepts: 'ball' },
);

base.tubes.push(
  { radius: 26, nodes: [{ x: 330, y: 659 }, { x: 700, y: 380 }, { x: 1000, y: STAND }] },
  { radius: 26, nodes: [{ x: 1700, y: STAND }, { x: 2050, y: 250 }, { x: 2270, y: B - 120 }] },
);

// Each sits just left of the switch it belongs on, so a rightward shove (or a carry) does it.
base.entities.push(
  { type: 'crate', x: 1060, y: 400 },
  { type: 'ball', x: 1240, y: 400 },
);

export const LEVEL_1 = base;
