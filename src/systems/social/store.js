// Local persistence for the social layer: friends, ignore list, chat prefs.
// Keyed per hero name so two characters on one browser keep separate lists.
const KEY = 'wayfarer.social.v1';

function readAll() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
function writeAll(all) { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* quota / private mode */ } }

export class SocialStore {
  constructor(owner = 'Wayfarer') {
    this.owner = String(owner || 'Wayfarer').toLowerCase();
    const d = readAll()[this.owner] || {};
    this.friends = Array.isArray(d.friends) ? d.friends.slice(0, 100) : [];
    this.ignored = Array.isArray(d.ignored) ? d.ignored.slice(0, 100) : [];
    this.prefs = { filter: true, timestamps: false, collapsed: null, tab: 'all', ...(d.prefs || {}) };
  }
  save() { const all = readAll(); all[this.owner] = { friends: this.friends, ignored: this.ignored, prefs: this.prefs }; writeAll(all); }
  has(list, name) { const n = String(name || '').toLowerCase(); return this[list].some((x) => x.toLowerCase() === n); }
  add(list, name) { name = String(name || '').trim().slice(0, 14); if (!name || this.has(list, name)) return false; this[list].push(name); this.save(); return true; }
  remove(list, name) { const n = String(name || '').toLowerCase(); const before = this[list].length; this[list] = this[list].filter((x) => x.toLowerCase() !== n); this.save(); return this[list].length !== before; }
  isFriend(name) { return this.has('friends', name); }
  isIgnored(name) { return this.has('ignored', name); }
  setPref(k, v) { this.prefs[k] = v; this.save(); }
}
