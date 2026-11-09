import Phaser from 'phaser';
import { settings } from '../core/settings.js';

// Hybrid sound: procedural WebAudio blips (always available, used by
// Title/Creator) + real CC0 ogg files via Phaser Sound once a scene with
// loaded audio exists (World/UIScene). Logical names map to ogg keys.
const OGG = {
  swing: ['sfx_swing_1', 'sfx_swing_2', 'sfx_swing_3'],
  hit: ['sfx_hit_1', 'sfx_hit_2'],
  monsterHurt: ['sfx_monster_hurt'],
  heavy: ['sfx_impact_heavy'],
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
  castBig: ['sfx_cast_big'],
  fireball: ['sfx_fireball'],
  explosion: ['sfx_explosion'],
  dash: ['sfx_whoosh_dash'],
  heal: ['sfx_heal'],
  potion: ['sfx_potion_drink'],
  npc: ['sfx_npc_blip'],
  alert: ['sfx_alert'],
  step: ['sfx_step_0', 'sfx_step_1', 'sfx_step_2', 'sfx_step_3'],
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

const AUDIO_DIR = { mus: 'music', amb: 'ambient', jng: 'jingles', sfx: 'sfx' };
const VARIED = new Set(['swing', 'hit', 'monsterHurt', 'step', 'cast', 'arrow']);
const ENCOUNTER_CUE_GAP = { captain: 1800, pincer: 850, rally: 900, cover: 750, start: 1800, victory: 1200 };

class AudioBus {
  constructor() {
    this.ctx = null; this.enabled = true;
    this.scene = null; this.musicKey = null; this.musicObj = null;
    this.combatMode = false; this.currentZone = 'town';
    this.encounterIntensity = 0; this._duckGain = 1; this._duckTimer = null; this._duckTween = null;
    this._cueAt = new Map();
    this.stepIdx = 0; this.lastStep = 0;
    // master/music/sfx volume sliders (pause menu > Settings)
    settings.onChange((k) => { if (k === 'master' || k === 'music') this.applyMusicVolume(); });
  }
  sfxVol() { return settings.get('master') * settings.get('sfx'); }
  musicVol() { return settings.get('master') * settings.get('music'); }
  musicTarget() {
    // Combat intensity adds presence without exceeding the exploration mix's
    // headroom. Ducking always wins so tactical cues remain readable.
    return 0.35 * this.musicVol() * (1 + this.encounterIntensity * 0.08) * this._duckGain;
  }
  applyMusicVolume(obj = this.musicObj) {
    if (!obj) return;
    try { obj.setVolume(this.musicTarget()); } catch { /* audio is non-critical */ }
  }
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
    if (logical === 'level' || logical === 'quest') this.duckMusic(logical === 'level' ? 0.32 : 0.44, 220, 980);
    const key = keys[Math.floor(Math.random() * keys.length)];
    if (this.scene && !this.scene.cache.audio.exists(key)) this.fetch(key); // warm for next time; blip now
    if (this.canPlay(key)) {
      try {
        const rate = VARIED.has(logical) ? 0.97 + Math.random() * 0.06 : 1;
        this.scene.sound.play(key, { volume: 0.5 * vol * this.sfxVol(), rate });
        return;
      } catch { /* fall through */ }
    }
    this.blipFor(logical);
  }
  // Start downloading a zone's track without switching to it (used under area-transition loading cards).
  warm(zoneId) {
    const key = MUSIC_FOR_ZONE[zoneId] || (String(zoneId).startsWith('mus_') ? zoneId : null);
    if (key && this.enabled && this.scene && !this.scene.cache.audio.exists(key)) this.fetch(key);
  }
  musicFor(zoneId) {
    if (!String(zoneId).startsWith('mus_')) this.currentZone = zoneId;
    const key = MUSIC_FOR_ZONE[zoneId] || (String(zoneId).startsWith('mus_') ? zoneId : 'mus_forest');
    if (key === this.musicKey || !this.enabled) return;
    this.wantMusic = key;
    if (!this.canPlay(key)) { this.fetch(key, () => { if (this.wantMusic === key && this.musicKey !== key) this.musicFor(key); }); return; }
    try {
      const prev = this.musicObj;
      const targetVol = this.musicTarget();
      const next = this.scene.sound.add(key, { volume: prev ? 0 : targetVol, loop: true });
      this.musicObj = next;
      next.play();
      if (prev && this.scene?.tweens) {
        const mix = { k: 0 };
        this.scene.tweens.add({ targets: mix, k: 1, duration: 650, ease: 'sine.inout',
          onUpdate: () => { try { next.setVolume(this.musicTarget() * mix.k); prev.setVolume(this.musicTarget() * (1 - mix.k)); } catch {} },
          onComplete: () => { try { prev.stop(); prev.destroy(); } catch {} },
        });
      } else prev?.stop();
      this.musicKey = key;
    } catch { /* ignore */ }
  }
  setCombat(active, zoneId = this.currentZone) {
    active = !!active;
    const wanted = active ? 'mus_tension' : (MUSIC_FOR_ZONE[zoneId] || 'mus_forest');
    if (active === this.combatMode && this.musicKey === wanted) return;
    this.combatMode = active;
    if (!active) this.setEncounterIntensity(0);
    this.musicFor(active ? 'mus_tension' : (zoneId || this.currentZone));
  }
  setEncounterIntensity(value = 0) {
    this.encounterIntensity = Math.max(0, Math.min(1, Number(value) || 0));
    this.applyMusicVolume();
    return this.encounterIntensity;
  }
  duckMusic(gain = 0.48, holdMs = 160, releaseMs = 760) {
    if (!this.musicObj || !this.scene) return false;
    this._duckTimer?.remove?.(false);
    this._duckTween?.stop?.();
    this._duckGain = Math.max(0.2, Math.min(1, gain));
    this.applyMusicVolume();
    const release = () => {
      if (!this.scene?.tweens) { this._duckGain = 1; this.applyMusicVolume(); return; }
      const mix = { gain: this._duckGain };
      this._duckTween = this.scene.tweens.add({
        targets: mix, gain: 1, duration: Math.max(120, releaseMs), ease: 'sine.out',
        onUpdate: () => { this._duckGain = mix.gain; this.applyMusicVolume(); },
        onComplete: () => { this._duckGain = 1; this._duckTween = null; this.applyMusicVolume(); },
      });
    };
    if (this.scene.time?.delayedCall) this._duckTimer = this.scene.time.delayedCall(Math.max(0, holdMs), release);
    else setTimeout(release, Math.max(0, holdMs));
    return true;
  }
  cueReady(id, now = this.scene?.time?.now ?? performance.now()) {
    const gap = ENCOUNTER_CUE_GAP[id] || 600;
    const last = this._cueAt.get(id);
    if (last != null && now < last + gap) return false;
    this._cueAt.set(id, now);
    return true;
  }
  // Small integration surface for EncounterDirector / Combat. All calls are
  // idempotent or throttled, and unknown event types safely do nothing.
  //   encounter('start', { zone, mythic })
  //   encounter('intensity', { value: 0..1 })
  //   encounter('warning', { role: 'captain'|'pincer'|'rally'|'cover' })
  //   encounter('victory'|'end'|'defeat', { zone })
  encounter(type, data = {}) {
    const zone = data.zone || this.currentZone;
    if (type === 'intensity') return this.setEncounterIntensity(data.value);
    if (type === 'start') {
      this.setCombat(true, zone);
      this.setEncounterIntensity(data.mythic ? 1 : Math.max(0.35, Number(data.intensity) || 0));
      if (this.cueReady('start')) { this.play(data.mythic ? 'roar' : 'alert', data.mythic ? 0.72 : 0.42); this.duckMusic(0.62, 120, 650); }
      return true;
    }
    if (type === 'warning') {
      const role = data.role;
      if (!ENCOUNTER_CUE_GAP[role] || !this.cueReady(role)) return false;
      const cue = role === 'captain' ? 'roar' : role === 'rally' ? 'castBig' : role === 'cover' ? 'heavy' : 'alert';
      const volume = role === 'captain' ? 0.6 : role === 'pincer' ? 0.48 : 0.4;
      this.play(cue, volume); this.duckMusic(role === 'pincer' ? 0.42 : 0.54, 90, 620);
      return true;
    }
    if (type === 'victory') {
      if (this.cueReady('victory')) { this.play('quest', 0.72); this.duckMusic(0.38, 260, 1000); }
      this.setCombat(false, zone);
      return true;
    }
    if (type === 'defeat') {
      this.play('error', 0.65); this.duckMusic(0.38, 220, 900); this.setCombat(false, zone);
      return true;
    }
    if (type === 'end') { this.setCombat(false, zone); return true; }
    return false;
  }
  encounterState() {
    return { active: this.combatMode, intensity: this.encounterIntensity, duck: this._duckGain, zone: this.currentZone, music: this.musicKey };
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
    this.stepIdx = (this.stepIdx + 1) % OGG.step.length;
    const key = OGG.step[this.stepIdx];
    if (this.scene && !this.scene.cache.audio.exists(key)) this.fetch(key);
    if (this.canPlay(key)) {
      try { this.scene.sound.play(key, { volume: 0.18 * this.sfxVol(), rate: 0.97 + Math.random() * 0.06 }); } catch {}
    }
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
