// Game Boy palettes — fullscreen tint + scanline overlay in UIScene.
export const PALETTES = {
  classic: { bg: 0x0f380f, dark: '#0f380f', light: '#9bbc0f', name: 'Classic' },
  pocket: { bg: 0x2b2b26, dark: '#2b2b26', light: '#c6c6a8', name: 'Pocket' },
  color: { bg: 0x1a1c2c, dark: '#1a1c2c', light: '#f4f4f4', name: 'Color' },
  modern: { bg: 0x0e1512, dark: '#0e1512', light: '#ffffff', name: 'Modern (off)' },
};

export function applyPalette(scene, key) {
  const p = PALETTES[key] || PALETTES.classic;
  const cam = scene.cameras.main;
  cam.setBackgroundColor(p.dark);
  return p;
}
