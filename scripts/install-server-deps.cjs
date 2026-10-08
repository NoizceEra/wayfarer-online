const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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
