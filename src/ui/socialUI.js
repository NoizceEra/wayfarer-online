import { social } from '../systems/social/index.js';
import { input } from '../core/input.js';
import { ChatPanel } from './ChatPanel.js';
import { SocialPanels } from './SocialPanels.js';
import { EmoteWheel } from './EmoteWheel.js';
import { PartyFrames } from './PartyFrames.js';
import { PetDuelRequest } from './PetDuelRequest.js';
import { PetPanel } from './PetPanel.js';

// Mounts the whole social UI for the HUD scene and registers the panel
// coordinator actions (anyOpen / closeAll) used by Esc handling.
export function installSocialUI(uiScene, { name, job, framesY = 134 } = {}) {
  social.init(name, job);
  const chat = new ChatPanel(uiScene);
  const panels = new SocialPanels(uiScene);
  const wheel = new EmoteWheel(uiScene);
  const frames = new PartyFrames(uiScene, 8, framesY);
  const petDuelReq = new PetDuelRequest(uiScene);
  const petPanel = new PetPanel(uiScene, {
    getRoster() { const w = uiScene.world(); return w?.meta?.pets?.roster || []; },
    setRoster(r) { const w = uiScene.world(); if (w?.meta?.pets) { w.meta.pets.roster = r; w.saveNow?.(); } },
    getActiveSlot() { const w = uiScene.world(); return w?.meta?.pets?.active ?? 0; },
    setActive(slot) { const w = uiScene.world(); if (w?.meta?.pets) { w.meta.pets.active = slot; w.saveNow?.(); } },
    save() { const w = uiScene.world(); w?.saveNow?.(); },
  });
  const offA = social.registerAction('anyOpen', () => chat.open || panels.anyOpen || wheel.open || !!petDuelReq.container || petPanel.isOpen);
  const offB = social.registerAction('closeAll', () => {
    let closed = false;
    if (chat.open) { chat.setOpen(false); closed = true; }
    if (panels.closeAll()) closed = true;
    if (wheel.open) { wheel.setOpen(false); closed = true; }
    if (petPanel.isOpen) { petPanel.close(); closed = true; }
    social._closedSomething = closed;
  });
  // hotkeys via the central input manager (rebindable, listed in the help overlay)
  input.registerAction({ id: 'party', label: 'Party panel', group: 'Social', keys: ['KeyP'], gameplay: true });
  input.registerAction({ id: 'friends', label: 'Players / friends', group: 'Social', keys: ['KeyO'], gameplay: true });
  input.registerAction({ id: 'emotes', label: 'Emote wheel', group: 'Social', keys: ['KeyG'], gameplay: true });
  input.registerAction({ id: 'petPanel', label: 'Pet panel', group: 'Social', keys: ['Backslash'], gameplay: true });
  const offKeys = [
    input.on('party', () => { social.act('openParty'); return true; }, { scene: uiScene }),
    input.on('friends', () => { social.act('openFriends'); return true; }, { scene: uiScene }),
    input.on('emotes', () => { social.act('openEmotes'); return true; }, { scene: uiScene }),
    input.on('petPanel', () => { petPanel.toggle(); return true; }, { scene: uiScene }),
  ];
  const api = {
    chat, panels, wheel, frames, petPanel, petDuelReq,
    anyOpen: () => chat.open || panels.anyOpen || wheel.open || !!petDuelReq.container || petPanel.isOpen,
    destroy() { offKeys.forEach((o) => o()); offA(); offB(); chat.destroy(); panels.destroy(); wheel.destroy(); frames.destroy(); petDuelReq.destroy(); petPanel.destroy(); },
  };
  if (typeof window !== 'undefined') window.__socialUI = api;
  uiScene.events.once('shutdown', () => { api.destroy(); if (typeof window !== 'undefined' && window.__socialUI === api) window.__socialUI = null; });
  return api;
}
