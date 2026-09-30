import { CFG } from './config.js';

// Tiny leveled logger: one JSON-ish line per event (Railway log search friendly).
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const min = LEVELS[CFG.LOG_LEVEL] ?? 20;

function out(level, msg, extra) {
  if ((LEVELS[level] ?? 20) < min) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`;
  (level === 'error' || level === 'warn' ? console.error : console.log)(line);
}

export const log = {
  debug: (m, e) => out('debug', m, e),
  info: (m, e) => out('info', m, e),
  warn: (m, e) => out('warn', m, e),
  error: (m, e) => out('error', m, e),
};
