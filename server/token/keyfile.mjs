/**
 * keyfile.mjs — write private key material so that it is ACTUALLY restricted.
 *
 * The bug this exists to prevent: `fs.writeFileSync(file, data, { mode: 0o600 })` looks
 * like it locks a file down, but on Windows the `mode` option is effectively ignored —
 * the file lands readable by other accounts on the machine, while the code (and the log
 * line it prints) claims "0600 owner-only". A security claim that is not enforced is
 * worse than no claim, because it stops anyone from checking.
 *
 * So: write, then HARDEN, then VERIFY by reading the result back, and report only what
 * was actually enforced.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** Restrict `file` to the current user only. Returns what was actually achieved. */
export function hardenFile(file) {
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(file, 0o600);
      const mode = fs.statSync(file).mode & 0o777;
      return { enforced: mode === 0o600, how: `chmod 600`, detail: mode.toString(8) };
    } catch (e) {
      return { enforced: false, how: 'chmod failed', detail: e.message };
    }
  }

  // Windows: drop inherited ACEs and grant only the current user. POSIX modes are
  // cosmetic here, so an ACL is the only real control.
  const who = process.env.USERNAME || process.env.USER;
  if (!who) return { enforced: false, how: 'no USERNAME', detail: 'cannot determine current user' };
  try {
    execFileSync('icacls', [file, '/inheritance:r', '/grant:r', `${who}:F`], { stdio: 'ignore' });
    const acl = execFileSync('icacls', [file], { encoding: 'utf8' });
    // Anything broader than the single user means it did not take.
    const broad = ['BUILTIN\\Users', 'Everyone', 'Authenticated Users', 'BUILTIN\\Administrators']
      .filter((g) => new RegExp(g.replace('\\', '\\\\'), 'i').test(acl));
    return {
      enforced: broad.length === 0,
      how: 'icacls user-only',
      detail: broad.length ? `still granted to: ${broad.join(', ')}` : acl.trim().split('\n').pop().trim(),
    };
  } catch (e) {
    return { enforced: false, how: 'icacls failed', detail: e.message };
  }
}

/** Write a secret file with a real access restriction. Throws if it cannot be enforced. */
export function writeSecretFile(file, data, { strict = true } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data, { mode: 0o600 });
  const res = hardenFile(file);
  if (strict && !res.enforced) {
    throw new Error(
      `refusing to leave a private key readable: could not restrict ${file} (${res.how}: ${res.detail})`,
    );
  }
  return res;
}

/** Human-readable one-liner that does not overstate the protection. */
export function describeHardening(res) {
  return res.enforced
    ? `restricted (${res.how})`
    : `NOT RESTRICTED (${res.how}: ${res.detail})`;
}
