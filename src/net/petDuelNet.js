import { net } from './NetworkManager.js';
import { bus, Events } from '../core/events.js';

// Client-side PvP pet duel API.
// Sends and receives 'pet-duel' messages through the generic relay.
// All handlers survive reconnects via net.onAttach.
//
// Outgoing actions:
//   challenge(name) -> { action:'challenge', target }
//   accept(name)    -> { action:'accept', target }
//   decline(name)   -> { action:'decline', target }
//   forfeit()       -> { action:'forfeit' }
//   sendTurn(turn)  -> { action:'turn', turn }
//
// Incoming server broadcasts:
//   challenge       -> { action:'challenge', from, fromName }
//   declined        -> { action:'declined', from, fromName }
//   start           -> { action:'start', a, b, aName, bName, aTeam, bTeam, seed }
//   turn            -> { action:'turn', a, b, round }
//   hpSync          -> { action:'hpSync', pets:[{id,hp}], a, b }
//   end             -> { action:'end', winner, reason }

const handlers = {
  turn: new Set(),
  challenge: new Set(),
  declined: new Set(),
  start: new Set(),
  result: new Set(),
};

let wired = false;
function ensureWired() {
  if (wired) return;
  wired = true;
  net.onAttach((room) => {
    room.onMessage('pet-duel', (m) => {
      const msg = m && typeof m === 'object' ? m : {};
      if (msg?.sessionId !== undefined) return; // ignore passthrough echo
      const action = msg.action;
      if (action === 'challenge') {
        for (const fn of handlers.challenge) safe(fn, msg);
      } else if (action === 'declined') {
        for (const fn of handlers.declined) safe(fn, msg);
      } else if (action === 'start') {
        for (const fn of handlers.start) safe(fn, msg);
      } else if (action === 'turn') {
        for (const fn of handlers.turn) safe(fn, msg);
      } else if (action === 'end') {
        for (const fn of handlers.result) safe(fn, msg);
      }
    });
  });
}

function safe(fn, ...args) { try { fn(...args); } catch (e) { console.error('[petDuelNet]', e); } }

function send(action, payload = {}) {
  if (!net.connected) { console.warn('[petDuelNet] offline'); return false; }
  return net.send('pet-duel', { action, ...payload });
}

export const petDuel = {
  challenge(name) { return send('challenge', { target: String(name || '') }); },
  accept(name)    { return send('accept', { target: String(name || '') }); },
  decline(name)   { return send('decline', { target: String(name || '') }); },
  forfeit()       { return send('forfeit'); },
  sendTurn(turn)  { return send('turn', { turn: turn && typeof turn === 'object' ? turn : {} }); },
  onTurn(fn)      { ensureWired(); handlers.turn.add(fn); return () => handlers.turn.delete(fn); },
  onChallenge(fn) { ensureWired(); handlers.challenge.add(fn); return () => handlers.challenge.delete(fn); },
  onDeclined(fn)  { ensureWired(); handlers.declined.add(fn); return () => handlers.declined.delete(fn); },
  onStart(fn)     { ensureWired(); handlers.start.add(fn); return () => handlers.start.delete(fn); },
  onResult(fn)    { ensureWired(); handlers.result.add(fn); return () => handlers.result.delete(fn); },
};
