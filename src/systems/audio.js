import Phaser from 'phaser';
import { settings } from '../core/settings.js';
import { whenWorldReady } from '../assets/worldLoad.js';

// Hybrid sound: procedural WebAudio blips (always available, used by
// Title/Creator) + real CC0 ogg files via Phaser Sound once a scene with
// loaded audio exists (World/UIScene). Logical names map to ogg keys.
const OGG = {
  swing: ['sfx_swing_1', 'sfx_swing_2'],
  hit: ['sfx_hit_1'],
  hurt: ['sfx_player_hurt'],
  monsterDie: ['sfx_monster_die'],
  coin: ['sfx_coin'],
  gold: ['sfx_gold'],
  level: ['jng_levelup1'],
  quest: ['jng_success3'],
  ui: ['sfx_ui_click'],
  error: ['sfx_ui_error'],
  arrow: ['sfx_arrow_shot'],
  cast: ['sfx_cast_1', 'sfx_cast_2'],
  fireball: ['sfx_fireball'],
  explosion: ['sfx_explosion'],
  dash: ['sfx_whoosh_dash'],
  heal: ['sfx_heal'],
  potion: ['sfx_potion_drink'],
  npc: ['sfx_npc_blip'],
  alert: ['sfx_alert'],
  step: ['sfx_step_0', 'sfx_step_1'],
  door: ['sfx_door_open'],
  roar: ['sfx_boss_roar'],
  slam: ['sfx_impact_heavy'],
  chest: ['sfx_chest_unlock'],
  warp: ['sfx_powerup'],
  pickup: ['sfx_pickup'],
};
const MUSIC_FOR_ZONE = {
  title: 'mus_title', town: 'mus_village', meadow: 'mus_forest', woods: 'mus_forest', ruins: 'mus_ruins',
  // expansion maps + interiors
  inn: 'mus_village', cottage_a: 'mus_village', cottage_b: 'mus_village',
  dock: 'mus_village_alt', dock_beach: 'mus_village_alt',
  crypt: 'mus_crypt', frost: 'mus_tension', frost_camp: 'mus_tension',
  // world expansion: desert / marsh / caverns / Hollow Depths (reused tracks)
  desert: 'mus_ruins', desert_temple: 'mus_boss_alt', desert_camp: 'mus_village_alt',
  marsh: 'mus_forest', marsh_isle: 'mus_tension', marsh_camp: 'mus_village',
  caverns: 'mus_tension', caverns_camp: 'mus_village_alt', hollow: 'mus_crypt',
};

// The title track is only fetched once the world preload has finished (so it never competes with first-load assets
// for bandwidth) or on the player's first gesture, whichever comes first. Browsers block autoplay before a gesture anyway.
let gate = null;
const titleMusicGate = () => (gate ||= new Promise((resolve) => {
  const evs = ['pointerdown', 'keydown', 'touchstart'];
  const go = () => { evs.forEach((e) => window.removeEventListener(e, go)); resolve(); };
  evs.forEach((e) => window.addEventListener(e, go, { passive: true }));
  whenWorldReady().then(go);
}));

const AUDIO_DIR ={ mus: 'music', amb: 'ambient', jng: 'jingles', sfx: 'sfx' };

class AudioBus {
  constructor() {
    this.ctx = null; this.enabled = true;
    this.scene = null; this.musicKey = null; this.musicObj = null;
    this.stepIdx = 0; this.lastStep = 0;
    // master/music/sfx volume sliders (pause menu > Settings)
    settings.onChange((k) => { if ((k === 'master' || k === 'music') && this.musicObj) { try { this.musicObj.setVolume(0.35 * this.musicVol()); } catch { /* ignore */ } } });
  }
  sfxVol() { return settings.get('master') * settings.get('sfx'); }
  musicVol() { return settings.get('master') * settings.get('music'); }
  attach(scene) { this.scene = scene; }
  canPlay(key) { return this.enabled && this.scene && this.scene.cache.audio.exists(key) && this.scene.sound; }
  // Lazy audio: music/jingles/ambient are NOT preloaded (10MB). Fetch on first use via the
  // attached scene's loader, then call cb. Dedupes in-flight requests; never throws.
  fetch(key, cb) {
    const s = this.host || this.scene; // host = Boot scene (persistent loader)
    if (!s || !s.load || !s.cache) return false;
    if (s.cache.audio.exists(key)) { cb?.(); return true; }
    const folder = AUDIO_DIR[key.slice(0, 3)];
    if (!folder) return false;
    const w = (this._pending ||= new Map());
    const prev = w.get(key);
    if (prev && prev.scene === s) { if (cb) prev.push(cb); return true; }
    const list = prev || []; // scene changed mid-load (old loader was torn down): re-request, keep callbacks
    if (cb) list.push(cb);
    list.scene = s;
    w.set(key, list);
    const done = () => { const cbs = w.get(key) || []; if (w.get(key)?.scene !== s) return; w.delete(key); cbs.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); };
    try {
      s.load.audio(key, `assets/audio/${folder}/${key}.ogg`);
      s.load.once(`filecomplete-audio-${key}`, done);
      s.load.once(`loaderror`, () => { if (w.has(key) && !s.cache.audio.exists(key)) w.delete(key); });
      if (!s.load.isLoading()) s.load.start();
    } catch { w.delete(key); return false; }
    return true;
  }
  play(logical, vol = 1) {
    const keys = OGG[logical];
    if (!keys) return;
    const key = keys[Math.floor(Math.random() * keys.length)];
    if (this.scene && !this.scene.cache.audio.exists(key)) this.fetch(key); // warm for next time; blip now
    if (this.canPlay(key)) { try { this.scene.sound.play(key, { volume: 0.5 * vol * this.sfxVol() }); return; } catch { /* fall through */ } }
    this.blipFor(logical);
  }
  // Start downloading a zone's track without switching to it (used under area-transition loading cards).
  warm(zoneId) {
    const key = MUSIC_FOR_ZONE[zoneId] || (String(zoneId).startsWith('mus_') ? zoneId : null);
    if (key && this.enabled && this.scene && !this.scene.cache.audio.exists(key)) this.fetch(key);
  }
  musicFor(zoneId) {
    const key = MUSIC_FOR_ZONE[zoneId] || (String(zoneId).startsWith('mus_') ? zoneId : 'mus_forest');
    if (key === this.musicKey || !this.enabled) return;
    this.wantMusic = key;
    if (!this.canPlay(key)) {
      const go = () => this.fetch(key, () => { if (this.wantMusic === key && this.musicKey !== key) this.musicFor(key); });
      if (key === 'mus_title') titleMusicGate().then(go); else go(); // ~1 MB: never compete with the first-load world assets
      return;
    }
    try {
      this.musicObj?.stop();
      this.musicObj = this.scene.sound.add(key, { volume: 0.35 * this.musicVol(), loop: true });
      this.musicObj.play();
      this.musicKey = key;
    } catch { /* ignore */ }
  }
  stopMusic() { this.wantMusic = null; try { this.musicObj?.stop(); } catch {} this.musicObj = null; this.musicKey = null; }
  toggle() {
    this.enabled = !this.enabled;
    if (!this.enabled) this.stopMusic();
    else this.musicKey = null; // force restart on next musicFor
    return this.enabled;
  }
  footstep(now) {
    if (now - this.lastStep < 320) return;
    this.lastStep = now;
    this.stepIdx = 1 - this.stepIdx;
    if (this.canPlay('sfx_step_0')) { try { this.scene.sound.play(this.stepIdx ? 'sfx_step_0' : 'sfx_step_1', { volume: 0.18 * this.sfxVol() }); return; } catch {} }
  }
  ensure() {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* no audio */ } }
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }
  blip(freq = 440, dur = 0.08, type = 'square', vol = 0.05) {
    if (!this.enabled) return;
    this.ensure(); if (!this.ctx) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.value = Math.max(0.0002, vol * this.sfxVol());
    o.connect(g); g.connect(this.ctx.destination);
    o.start(); g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
    o.stop(this.ctx.currentTime + dur);
  }
  blipFor(logical) {
    if (logical === 'coin' || logical === 'gold') { this.blip(880, 0.08); setTimeout(() => this.blip(1320, 0.1), 60); }
    else if (logical === 'level' || logical === 'quest') [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.blip(f, 0.12), i * 90));
    else if (logical === 'error') this.blip(160, 0.15);
    else if (logical === 'hit' || logical === 'hurt') this.blip(140, 0.12);
    else if (logical === 'swing' || logical === 'arrow') this.blip(220, 0.1, 'sawtooth', 0.04);
    else this.blip(660, 0.05);
  }
  // Back-compat API used by Title/Creator/World/UIScene
  swing() { this.play('swing', 0.8); }
  hit() { this.play('hit'); }
  coin() { this.play('coin', 0.8); }
  level() { this.play('level'); }
  ui() { this.play('ui', 0.7); }
  error() { this.play('error'); }
}
export const audio = new AudioBus();
