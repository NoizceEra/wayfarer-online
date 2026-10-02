import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const TRAILER_DIR = 'public/trailer';
const OUT = path.join(TRAILER_DIR, 'wayfarer_login_bg.mp4');

// Segments to pull from each trailer (start, duration)
const segments = [
  { file: 'wayfarer_trailer.mp4', start: 2, dur: 3.5 },           // main trailer hook
  { file: 'wayfarer_playstyles_trailer.mp4', start: 5, dur: 3.5 }, // gameplay variety
  { file: 'wayfarer_marketplace_trailer.mp4', start: 6, dur: 3.5 }, // trading action
  { file: 'wayfarer_bestiary_trailer.mp4', start: 5, dur: 3.5 },   // monsters
  { file: 'wayfarer_seasonal_trailer.mp4', start: 6, dur: 3.5 },   // seasonal vibes
];

const tmpDir = fs.mkdtempSync(path.resolve('tmp-trailer-'));
const listPath = path.join(tmpDir, 'list.txt');
const listLines = [];

for (let i = 0; i < segments.length; i++) {
  const seg = segments[i];
  const inFile = path.join(TRAILER_DIR, seg.file);
  const outFile = path.join(tmpDir, `seg_${i}.mp4`);
  // Re-encode to uniform format so concat works cleanly
  const cmd = `ffmpeg -y -hide_banner -loglevel error -ss ${seg.start} -t ${seg.dur} -i "${inFile}" -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,setsar=1,format=yuv420p" -c:v libx264 -preset fast -crf 23 -r 30 -an "${outFile}"`;
  console.log(`Extracting + scaling segment ${i}: ${seg.file} @ ${seg.start}s for ${seg.dur}s`);
  execSync(cmd, { stdio: 'inherit' });
  listLines.push(`file '${outFile.replace(/\\/g, '/')}'`);
}

fs.writeFileSync(listPath, listLines.join('\n') + '\n');

// Simple concat (no crossfade — for background loop, hard cuts are fine and smaller)
const concatCmd = `ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "${listPath}" -c copy -movflags +faststart "${OUT}"`;
console.log('Concatenating segments...');
execSync(concatCmd, { stdio: 'inherit' });

// Cleanup tmp files
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`Done: ${OUT}`);
