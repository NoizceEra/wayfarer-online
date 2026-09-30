import { social, installFallbackKeys } from '../systems/social/index.js';
import { ChatPanel } from './ChatPanel.js';
import { SocialPanels } from './SocialPanels.js';
import { EmoteWheel } from './EmoteWheel.js';
import { PartyFrames } from './PartyFrames.js';

// Mounts the whole social UI for the HUD scene and registers the panel
// coordinator actions (anyOpen / closeAll) used by Esc handling.
export function installSocialUI(uiScene, { name, job, framesY = 134 } = {}) {
  social.init(name, job);
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
  installFallbackKeys();
  const api = {
    chat, panels, wheel, frames,
    anyOpen: () => chat.open || panels.anyOpen || wheel.open,
    destroy() { offA(); offB(); chat.destroy(); panels.destroy(); wheel.destroy(); frames.destroy(); },
  };
  uiScene.events.once('shutdown', () => api.destroy());
  return api;
}
