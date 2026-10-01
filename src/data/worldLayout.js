// Overworld layout data (pure data, tile coords on the 128x128 map): roads, rivers, bridges,
// landmarks, camps and the extra signposts. Geometry lives in world/waterways.js, art in
// world/overworldRoads.js (ground bake) and world/landmarks.js (props, NPCs, interactables).

// kind: 'main' packed-earth road, 'cobble' flagstone road, 'track' narrow farm track
export const ROADS = [
  // town E-W road: west to the Emberdeep descent, east through Mosswood to the lighthouse trail
  { id: 'east', kind: 'main', pts: [[37.75, 64], [51.5, 64], [64, 64], [76.5, 64], [84.6, 63.1], [90, 61.6], [94, 61.2], [97, 59.2], [101.5, 54.6]] },
  // town N-S road: north to Hollow Depths, south through the ruins
  { id: 'ns', kind: 'main', pts: [[64, 24], [63, 30], [65, 36], [64, 43.4], [64, 54], [64, 64], [64, 75.3], [62.1, 81.6], [57.1, 85.9], [49.6, 89.6]] },
  // Harbour road (cobbled) from the east road to the Harbour Gate
  { id: 'harbour', kind: 'cobble', pts: [[84.6, 63.1], [85.6, 65.8], [87.5, 67.2], [90, 67.4], [92.5, 68.6], [95, 73], [97, 80], [99, 88], [101, 94], [104, 98.8]] },
  // Sunscorch Gate
  { id: 'desert', kind: 'main', pts: [[97, 80], [104, 81.5], [111, 80.6]] },
  // Whisperfen Path
  { id: 'marsh', kind: 'main', pts: [[62.1, 81.6], [65, 92], [69, 101], [73, 108], [74, 110.8]] },
  // Crypt Stairs (old flagstones)
  { id: 'crypt', kind: 'cobble', pts: [[57.1, 85.9], [49, 87.2], [43, 87.4], [40.2, 88.2]] },
  // Frostpeak Pass: up from the west road
  { id: 'frost', kind: 'main', pts: [[40, 64], [43, 58], [46, 52], [43, 48.5], [41, 45.6], [39, 44.6], [37.6, 44.4], [35.5, 44.2], [32.5, 42], [30, 40], [27, 32], [24, 26], [20.5, 21], [18, 19]] },
  // Emberdeep Descent: west road continued
  { id: 'caverns', kind: 'main', pts: [[37.75, 64], [28, 62.4], [20, 58], [14, 54], [11.6, 52.8]] },
  // second link Frost road -> caverns
  { id: 'cavlink', kind: 'track', pts: [[30, 40], [22, 46], [15, 52]] },
  // Northway: Frostpeak -> Hollow
  { id: 'northway', kind: 'main', pts: [[24, 26], [34, 25], [44, 23.5], [54, 24.5], [63, 26]] },
  // Mosswood trail to the north-coast lighthouse
  { id: 'lighthouse', kind: 'main', pts: [[101.5, 54.6], [103, 46], [106, 36], [108, 26], [111, 16.5], [112.6, 11.4]] },
  // woods -> desert link
  { id: 'woodsdesert', kind: 'main', pts: [[101.5, 54.6], [104, 63], [103, 72], [101, 80.2]] },
  // tracks to landmarks
  { id: 't_mill', kind: 'track', pts: [[65, 38], [70, 37], [75.5, 36.4]] },
  { id: 't_tower', kind: 'track', pts: [[63, 29], [60, 22], [57.2, 16.6]] },
  { id: 't_shrine', kind: 'track', pts: [[64, 46], [60, 41], [55, 37.5]] },
  { id: 't_camp1', kind: 'track', pts: [[63.2, 29.6], [68, 29.5]] },
  { id: 't_camp2', kind: 'track', pts: [[102.4, 50], [105.5, 50.2]] },
  { id: 't_camp3', kind: 'track', pts: [[20.5, 57.8], [22, 54.4]] },
  { id: 't_camp4', kind: 'track', pts: [[99.3, 88.6], [104.5, 88.8]] },
];

export const RIVERS = [
  // Silverrun: Frostpeak meltwater out of the north rim, down the west of the island to the south coast
  { id: 'silverrun', name: 'Silverrun', w: [17, 25], pts: [[50, -2], [49, 10], [46, 18], [44, 26], [41, 34], [38, 42], [37, 50], [36.5, 57], [36.8, 64], [35, 72], [31, 80], [27, 88], [25, 98], [24, 110], [24, 130]] },
  // Eastwater: down Mosswood, past the harbour road, to the south-east sea
  { id: 'eastwater', name: 'Eastwater', w: [14, 22], pts: [[92, -2], [91, 14], [93, 26], [95, 36], [95, 46], [92, 55], [90, 62], [88, 70], [88, 76], [90, 84], [93, 92], [96, 100], [98, 108], [96, 130]] },
];

// Bridges: axis 'h' = deck runs east-west (len tiles long, w px wide). (x, y) = tile centre.
export const BRIDGES = [
  { id: 'b_town', name: 'Old Stone Bridge', kind: 'stone', x: 36.8, y: 64, len: 7, w: 40 },
  { id: 'b_frost', name: 'Frostway Bridge', kind: 'wood', x: 37.6, y: 44.4, len: 6, w: 36 },
  { id: 'b_troll', name: 'Troll Bridge', kind: 'wood', x: 44.7, y: 23.5, len: 6, w: 36 },
  { id: 'b_moss', name: 'Mosswood Bridge', kind: 'wood', x: 90.1, y: 61.6, len: 6, w: 36 },
  { id: 'b_harbour', name: 'Harbour Bridge', kind: 'stone', x: 88.6, y: 67.3, len: 6, w: 40 },
];

// Landmarks (also drawn on the minimap / world map). type: light | mill | tower | camp | shrine | troll | bridge
export const LANDMARKS = [
  { id: 'lighthouse', name: "Mara's Lighthouse", type: 'light', tx: 116.3, ty: 7.1 },
  { id: 'windmill', name: 'Meadowfield Windmill', type: 'mill', tx: 77, ty: 34 },
  { id: 'tower', name: 'Ruined Watchtower', type: 'tower', tx: 57, ty: 15 },
  { id: 'shrine', name: 'Dawnstone Circle', type: 'shrine', tx: 53.5, ty: 36 },
  { id: 'camp1', name: 'Hollow Road Rest', type: 'camp', tx: 69.5, ty: 29.5 },
  { id: 'camp2', name: "Hunters' Fire", type: 'camp', tx: 106.5, ty: 50.2 },
  { id: 'camp3', name: "Shepherd's Fire", type: 'camp', tx: 22.5, ty: 53 },
  { id: 'camp4', name: "Dockhands' Camp", type: 'camp', tx: 105.5, ty: 88.6 },
  { id: 'troll', name: 'Troll Bridge', type: 'troll', tx: 44.7, ty: 23.5 },
];

// Extra signposts at forks and landmarks (merged into SIGNS by data/areas.js)
export const LAYOUT_SIGNS = [
  { tx: 44, ty: 62, planks: [{ dir: 'n', text: 'Frostpeak Pass', lv: 'Lv 11-15' }, { dir: 'w', text: 'Emberdeep Descent', lv: 'Lv 15-19' }, { dir: 'e', text: 'Thistle Town', lv: 'safe' }] },
  { tx: 56, ty: 83.6, planks: [{ dir: 'w', text: 'Crypt Stairs', lv: 'Lv 9-13' }, { dir: 's', text: 'Tidehollow Ruins', lv: 'Lv 8-12' }, { dir: 'n', text: 'Thistle Town', lv: 'safe' }] },
  { tx: 26.6, ty: 28.2, planks: [{ dir: 'n', text: 'Frostpeak Pass', lv: 'Lv 11-15' }, { dir: 'e', text: 'Hollow Depths (Northway)', lv: 'Lv 12-20' }, { dir: 's', text: 'Thistle Town', lv: 'safe' }] },
  { tx: 99.4, ty: 56.6, planks: [{ dir: 'n', text: "Lookout Mara's Lighthouse", lv: 'Lv 4-8' }, { dir: 'e', text: 'Sunscorch Gate', lv: 'Lv 13-17' }, { dir: 'w', text: 'Thistle Town', lv: 'safe' }] },
  { tx: 66.6, ty: 39.6, planks: [{ dir: 'e', text: 'Meadowfield Windmill', lv: 'Lv 1-4' }] },
  { tx: 61.4, ty: 31.4, planks: [{ dir: 'w', text: 'Old Watchtower', lv: 'Lv 1-4' }] },
  { tx: 62.4, ty: 44.8, planks: [{ dir: 'w', text: 'Dawnstone Circle', lv: 'blessing' }] },
  { tx: 43, ty: 25.6, planks: [{ dir: 'e', text: 'Troll Bridge - toll: a kind word', lv: 'Lv 1-4' }] },
];
