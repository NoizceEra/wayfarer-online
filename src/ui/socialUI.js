import { social } from '../systems/social/index.js';
import { input } from '../core/input.js';
import { ChatPanel } from './ChatPanel.js';
import { SocialPanels } from './SocialPanels.js';
import { EmoteWheel } from './EmoteWheel.js';
import { PartyFrames } from './PartyFrames.js';
import { socialRoot, el } from './socialDom.js';

// Mounts the whole social UI for the HUD scene and registers the panel
// coordinator actions (anyOpen / closeAll) used by Esc handling.
export function installSocialUI(uiScene, { name, job, framesY = 134 } = {}) {
  social.init(name, job);
  // hotkeys via the central input manager (rebindable, listed in the help overlay).
  // Registered BEFORE the panels are built so their key hints read the real
  // bindings. O and R both open the people panel; R is a second chance for
  // anyone who never reads a hotkey list, and the always-visible PEOPLE chip
  // labels it in plain words.
  input.registerAction({ id: 'party', label: 'Party panel', group: 'Social', keys: ['KeyP'], gameplay: true });
  input.registerAction({ id: 'friends', label: 'Friends & players', group: 'Social', keys: ['KeyO', 'KeyR'], gameplay: true });
  input.registerAction({ id: 'emotes', label: 'Emote wheel', group: 'Social', keys: ['KeyG'], gameplay: true });
  const chat = new ChatPanel(uiScene);
  const panels = new SocialPanels(uiScene);
  const wheel = new EmoteWheel(uiScene);
  const frames = new PartyFrames(uiScene, 8, framesY);
  const offA = social.registerAction('anyOpen', () => chat.open || panels.anyOpen || wheel.open);
  const offB = social.registerAction('closeAll', () => {
    let closed = false;
    if (chat.open) { chat.setOpen(false); closed = true; }
    if (panels.closeAll()) closed = true;
    if (wheel.open) { wheel.setOpen(false); closed = true; }
    social._closedSomething = closed;
  });
  const offKeys = [
    input.on('party', () => { social.act('openParty'); return true; }, { scene: uiScene }),
    input.on('friends', () => { social.act('openFriends'); return true; }, { scene: uiScene }),
    input.on('emotes', () => { social.act('openEmotes'); return true; }, { scene: uiScene }),
  ];
  // Always-visible, plainly-labelled way in: nobody should have to guess a hotkey.
  // Sits beside the chat chip, opens the same people panel (online / friends /
  // guild / ignored + quick buttons for chat, party and emotes).
  const hub = el('button', 'wf-panel wf-chip', `PEOPLE ${input.labelFor('friends', 2)}`);
  hub.style.left = '58px';
  hub.title = 'Friends, party, guild, chat and trade';
  hub.addEventListener('click', () => social.act('openFriends'));
  socialRoot().appendChild(hub);
  const api = {
    chat, panels, wheel, frames,
    anyOpen: () => chat.open || panels.anyOpen || wheel.open,
    destroy() {
      offKeys.forEach((o) => o()); offA(); offB();
      chat.destroy(); panels.destroy(); wheel.destroy(); frames.destroy(); hub.remove();
    },
  };
  uiScene.events.once('shutdown', () => api.destroy());
  return api;
}
