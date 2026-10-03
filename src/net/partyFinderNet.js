import { CONFIG } from '../config.js';

// Party Finder net client (companion to server/partyFinder.js): one fetch to
// GET /party-finder, returning the parsed rooms array. httpBase() is
// replicated from NetworkManager.js (a 2-line local helper — importing the
// whole net singleton here would drag in the save/progression pipeline).
const httpBase = () => CONFIG.serverUrl.replace(/^ws/, 'http');

// listOpenRooms() -> [{ code, players, maxPlayers, hostName, level, area, createdAt }]
// (newest first). Throws Error('...') with a human message on offline/HTTP
// errors so callers can surface it directly; never returns null/undefined.
export async function listOpenRooms() {
  let res;
  try {
    res = await fetch(`${httpBase()}/party-finder`);
  } catch {
    throw new Error('Relay unreachable — is the server running?');
  }
  if (!res.ok) throw new Error(`Party Finder failed (HTTP ${res.status}).`);
  let data;
  try { data = await res.json(); } catch { throw new Error('Party Finder sent a bad reply.'); }
  if (!data?.ok || !Array.isArray(data.rooms)) throw new Error('Party Finder sent a bad reply.');
  return data.rooms;
}
