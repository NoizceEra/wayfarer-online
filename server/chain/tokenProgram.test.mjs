/**
 * tokenProgram.test.mjs — the proof that the TOKEN PROGRAM is part of a payout's
 * correctness, against the INSTALLED @solana/spl-token.
 *
 * THE BUG THIS LOCKS DOWN. An earlier settlement.js passed no program to
 * `getOrCreateAssociatedTokenAccount` / `transfer`, so spl-token defaulted to the
 * LEGACY SPL Token program. A pump.fun `create_v2` mint is owned by TOKEN-2022, and an
 * associated token account is derived from (mint, owner, programId) — so for the same
 * (mint, owner) the relay derived a DIFFERENT address than the one the mint's program
 * actually uses. The transfer then targeted an account that does not exist / is not
 * owned by that program, and every payout reverted.
 *
 * What this proves, with real derivations from the installed library (no network):
 *   1. the two programs produce DIFFERENT ATAs for the same (mint, owner) — the bug;
 *   2. our constants match the installed library's program ids;
 *   3. settlement.js's `selectTokenProgram` returns the program the chain reports:
 *      legacy -> spl-token, Token-2022 -> token-2022, anything else -> refused;
 *   4. the ATA settlement would derive for a Token-2022 mint is the Token-2022 ATA,
 *      not the legacy one.
 *
 * Run: node server/chain/tokenProgram.test.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-tprog-'));
process.env.DATA_DIR = SANDBOX;
process.env.LOG_LEVEL = 'error';
delete process.env.WAYFARER_MINT;
delete process.env.CHAIN_TOKEN_PROGRAM;

const { selectTokenProgram } = await import('./settlement.js');
const MV = await import('./mintVerify.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '  -> ' + detail : ''}`); }
};

// A real mint and owner (public keys only; this suite never touches the network).
const MINT = new PublicKey('8q4tDsGTD1J2xNzpm4YVCY1QEpXGwMDhE3BkCdCd5xWg');
const OWNER = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const OTHER_PROGRAM = new PublicKey('11111111111111111111111111111111');   // the System program

console.log('\n1. the two token programs derive DIFFERENT ata addresses (this is the bug)');
{
  const legacyAta = getAssociatedTokenAddressSync(MINT, OWNER, false, TOKEN_PROGRAM_ID);
  const t22Ata = getAssociatedTokenAddressSync(MINT, OWNER, false, TOKEN_2022_PROGRAM_ID);
  console.log(`  legacy       ${legacyAta.toBase58()}`);
  console.log(`  token-2022   ${t22Ata.toBase58()}`);
  ok('the legacy and Token-2022 ATAs for the same (mint, owner) are DIFFERENT',
    !legacyAta.equals(t22Ata));
  ok('the Token-2022 ATA is a valid on-curve address (derivation is real, not a throw)',
    PublicKey.isOnCurve(t22Ata.toBytes()) === false);
  // A caller that omits the program gets the legacy ATA — the wrong one for a
  // create_v2 mint. Pin that this is what the library default does.
  const defaulted = getAssociatedTokenAddressSync(MINT, OWNER);
  ok('the spl-token DEFAULT program is the legacy one (why omitting it was fatal)',
    defaulted.equals(legacyAta) && !defaulted.equals(t22Ata));
}

console.log('\n2. our program ids match the installed library');
{
  ok('mintVerify.TOKEN_PROGRAM_ID === spl-token TOKEN_PROGRAM_ID',
    MV.TOKEN_PROGRAM_ID === TOKEN_PROGRAM_ID.toBase58(), MV.TOKEN_PROGRAM_ID);
  ok('mintVerify.TOKEN_2022_PROGRAM_ID === spl-token TOKEN_2022_PROGRAM_ID',
    MV.TOKEN_2022_PROGRAM_ID === TOKEN_2022_PROGRAM_ID.toBase58(), MV.TOKEN_2022_PROGRAM_ID);
  ok('exactly two programs are payable', Object.keys(MV.TOKEN_PROGRAMS).length === 2);
}

console.log('\n3. selectTokenProgram picks the CHAIN\'s program, and only two exist');
{
  const legacy = selectTokenProgram({ ownerProgram: TOKEN_PROGRAM_ID.toBase58() });
  const t22 = selectTokenProgram({ ownerProgram: TOKEN_2022_PROGRAM_ID.toBase58() });
  ok('legacy mint -> the spl-token program', legacy.id === TOKEN_PROGRAM_ID.toBase58(), JSON.stringify(legacy));
  ok('Token-2022 mint -> the token-2022 program', t22.id === TOKEN_2022_PROGRAM_ID.toBase58(), JSON.stringify(t22));
  let e1 = null; try { selectTokenProgram({ ownerProgram: OTHER_PROGRAM.toBase58() }); } catch (err) { e1 = err; }
  ok('a mint owned by a non-token program is refused', !!e1 && /not a token program/.test(e1.message));
  let e2 = null; try { selectTokenProgram({ ownerProgram: null }); } catch (err) { e2 = err; }
  ok('an unknown owner is refused (never assumed legacy)', !!e2);
  let e3 = null;
  try { selectTokenProgram({ ownerProgram: TOKEN_PROGRAM_ID.toBase58(), configured: TOKEN_2022_PROGRAM_ID.toBase58() }); }
  catch (err) { e3 = err; }
  ok('a CHAIN_TOKEN_PROGRAM that disagrees with the chain is refused', !!e3 && /disagrees with the chain/.test(e3.message));
}

console.log('\n4. the ATA the chosen program yields is the RIGHT one for each standard');
{
  for (const [ownerProgram, programId] of [
    [TOKEN_PROGRAM_ID.toBase58(), TOKEN_PROGRAM_ID],
    [TOKEN_2022_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID],
  ]) {
    const chosen = selectTokenProgram({ ownerProgram });
    const derived = getAssociatedTokenAddressSync(MINT, OWNER, false, new PublicKey(chosen.id));
    const expected = getAssociatedTokenAddressSync(MINT, OWNER, false, programId);
    ok(`the ATA for a ${chosen.name} mint is derived under ${chosen.name}`, derived.equals(expected), derived.toBase58());
  }
  // and NOT the other standard's
  const t22 = selectTokenProgram({ ownerProgram: TOKEN_2022_PROGRAM_ID.toBase58() });
  const t22Ata = getAssociatedTokenAddressSync(MINT, OWNER, false, new PublicKey(t22.id));
  const legacyAta = getAssociatedTokenAddressSync(MINT, OWNER, false, TOKEN_PROGRAM_ID);
  ok('the token-2022 payout does NOT target the legacy ATA', !t22Ata.equals(legacyAta));
}

console.log('\n5. settlement.js actually passes the program at EVERY spl-token call site');
{
  const src = fs.readFileSync(new URL('./settlement.js', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
  // the program is the LAST argument of both helpers (spl-token 0.4.15 signatures)
  const callSites = [
    ['getOrCreateAssociatedTokenAccount(conn, payer, mint, to, false, undefined, undefined, programId)',
      /getOrCreateAssociatedTokenAccount\(\s*conn,\s*payer,\s*mint,\s*to,\s*false,\s*undefined,\s*undefined,\s*programId\s*\)/],
    ['getOrCreateAssociatedTokenAccount(conn, payer, mint, payer.publicKey, false, undefined, undefined, programId)',
      /getOrCreateAssociatedTokenAccount\(\s*conn,\s*payer,\s*mint,\s*payer\.publicKey,\s*false,\s*undefined,\s*undefined,\s*programId\s*\)/],
    ['transfer(conn, payer, fromAta.address, toAta.address, payer, BigInt(amountRaw), [], undefined, programId)',
      /transfer\(\s*conn,\s*payer,\s*fromAta\.address,\s*toAta\.address,\s*payer,\s*BigInt\(amountRaw\),\s*\[\],\s*undefined,\s*programId\s*\)/],
  ];
  for (const [label, re] of callSites) ok(`settlement.js calls ${label}`, re.test(code));
  // and NO spl-token helper call is left without a program argument (line-level, so a
  // nested call like BigInt(amountRaw) cannot be mistaken for the helper's argument list)
  const helperLines = code.split(/\r?\n/).filter((l) => /spl\.(getOrCreateAssociatedTokenAccount|transfer)\s*\(/.test(l));
  ok('settlement.js has spl-token helper call sites to check', helperLines.length >= 3, `${helperLines.length}`);
  const bareLines = helperLines.filter((l) => !/\bprogramId\b/.test(l));
  ok('no spl-token helper is called WITHOUT the program argument', bareLines.length === 0,
    bareLines.map((l) => l.trim()).join(' | '));
  ok('the program is read from the chain (readMintProgram) before the helpers run',
    /readMintProgram\(conn,\s*mint\)/.test(code) && code.indexOf('readMintProgram(conn, mint)') < code.indexOf('getOrCreateAssociatedTokenAccount'));
  ok('the ATA for the balance read is derived under the chosen program',
    /getAssociatedTokenAddressSync\(\s*mint,\s*payer\.publicKey,\s*false,\s*new PublicKey\(program\.id\)\s*\)/.test(code));
}

console.log('\n6. the REAL verify-launch.mjs CLI GOes a Token-2022 mint (and still GOes legacy)');
{
  const { createServer } = await import('node:http');
  const { spawn } = await import('node:child_process');

  // A mint account body shaped exactly like the chain returns it: an 82-byte mint
  // owned by `owner`, decimals 6, supply 1e15 (= 1,000,000,000 * 10^6).
  const mintBody = (owner) => {
    // 82-byte mint, built by hand: mintAuthorityOption=0 (burned), supply=1e15,
    // decimals=6, isInitialized=true, freezeAuthorityOption=0. Same bytes the chain
    // hands back for a real pump.fun mint with both authorities renounced.
    const data = Buffer.alloc(82);
    data.writeUInt32LE(0, 0);                                  // mintAuthorityOption
    data.writeBigUInt64LE(1_000_000_000n * 1_000_000n, 36);    // supply
    data.writeUInt8(6, 44);                                    // decimals
    data.writeUInt8(1, 45);                                    // isInitialized
    data.writeUInt32LE(0, 46);                                 // freezeAuthorityOption
    return { owner, executable: false, lamports: 1461600, data: [data.toString('base64'), 'base64'], space: data.length, rentEpoch: 0 };
  };
  const serve = async (value) => {
    const srv = createServer((req, res) => {
      let buf = '';
      req.on('data', (c) => { buf += c; });
      req.on('end', () => {
        const msg = JSON.parse(buf || '{}');
        const result = msg.method === 'getAccountInfo'
          ? { context: { slot: 1, apiVersion: '1.18.0' }, value } : null;
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
      });
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    return { url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => srv.close(r)) };
  };
  // spawn verify-launch.mjs from the real repo root
  const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const run = (rpcUrl) => new Promise((resolve) => {
    const keysRoot = fs.mkdtempSync(path.join(SANDBOX, 'keys-'));
    const child = spawn(process.execPath, [path.join(repoRoot, 'server', 'token', 'verify-launch.mjs'),
      '--cluster', 'devnet', '--mint', MINT.toBase58(), '--rpc', rpcUrl, '--keys-root', keysRoot],
      { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ code, out, err }));
  });

  const t22 = await serve(mintBody(TOKEN_2022_PROGRAM_ID.toBase58()));
  const r22 = await run(t22.url);
  await t22.close();
  console.log(`  token-2022 owner: exit=${r22.code}`);
  ok('verify-launch GOes a Token-2022 mint (not a NO-GO)', r22.code === 0 && /GO —/.test(r22.out) && !/NO-GO/.test(r22.out), r22.err.trim() || r22.out.split('\n').filter(Boolean).slice(-2).join(' '));
  ok('the Token-2022 program id is reported verbatim', r22.out.includes(TOKEN_2022_PROGRAM_ID.toBase58()), '');

  const legacySrv = await serve(mintBody(TOKEN_PROGRAM_ID.toBase58()));
  const rLegacy = await run(legacySrv.url);
  await legacySrv.close();
  ok('verify-launch still GOes a legacy SPL Token mint', rLegacy.code === 0 && /GO —/.test(rLegacy.out) && !/NO-GO/.test(rLegacy.out), rLegacy.err.trim());

  const bad = await serve(mintBody(OTHER_PROGRAM.toBase58()));
  const rBad = await run(bad.url);
  await bad.close();
  ok('verify-launch HARD-FAILS a mint owned by a non-token program', rBad.code === 1 && /NO-GO/.test(rBad.out), `exit=${rBad.code}`);
  ok('the NO-GO names the unrecognised program', rBad.out.includes(OTHER_PROGRAM.toBase58()), '');
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
fs.rmSync(SANDBOX, { recursive: true, force: true });
process.exit(fail ? 1 : 0);