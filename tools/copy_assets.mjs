// Re-seeds public/assets from the Lanternfall curation (CC0 anchor).
// Run: npm run copy-assets
import { cpSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcCandidates = [
  join(root, 'public_assets_seed'),
  join(root, '..', 'rpg-foundation', 'public', 'assets'),
  join('D:', 'ai-studio', 'rpg-foundation', 'public', 'assets'),
];
const dest = join(root, 'public', 'assets');
const src = srcCandidates.find((p) => existsSync(p));
if (!src) { console.error('No asset source found. Expected one of:', srcCandidates); process.exit(1); }
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`Seeded public/assets from ${src}`);
