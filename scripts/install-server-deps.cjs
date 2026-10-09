const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Vercel builds the CLIENT only. Installing the relay's dependencies here is pure
// waste - it pulls native modules (better-sqlite3) into a build that never runs the
// server - and it is a needless failure point. Vercel sets VERCEL=1 during builds.
if (process.env.VERCEL) {
  console.log('Skipping server dependencies: this is a client-only Vercel build.');
  process.exit(0);
}

const lockfile = path.resolve(__dirname, '..', 'server', 'package-lock.json');
if (!fs.existsSync(lockfile)) {
  console.log('Skipping server dependencies: server files are not part of this deployment.');
  process.exit(0);
}

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error('Cannot locate npm to install server dependencies.');
  process.exit(1);
}

const result = spawnSync(process.execPath, [npmCli, 'ci', '--prefix', path.dirname(lockfile)], { stdio: 'inherit' });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
