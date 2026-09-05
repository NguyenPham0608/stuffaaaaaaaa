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

export const LEVEL_1 = base;
