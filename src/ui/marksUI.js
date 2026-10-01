import { input } from '../core/input.js';
import { marks } from '../net/marksNet.js';
import { WalletPanel } from './WalletPanel.js';
import { MarksPanel } from './MarksPanel.js';
import { socialRoot } from './socialDom.js';

// HUD mount for optional wallet + Wayfarer Marks. Hotkey Z (rebindable).
// Solo works; nothing is sent until Play Online. Never auto-prompts a wallet.

export function installMarksUI(uiScene) {
  socialRoot();
  marks.setWorld(() => {
    const w = uiScene.scene.get('world');
    return w?.sys?.isActive?.() && w.player ? w : null;
  });
  const walletP = new WalletPanel();
  const marksP = new MarksPanel(walletP);

  input.registerAction({ id: 'marks', label: 'Wayfarer Marks', group: 'Panels', keys: ['KeyZ'], gameplay: true });
  const anyOpen = () => marksP.isOpen || walletP.isOpen;
  const offs = [
    input.on('marks', () => { if (walletP.isOpen) walletP.close(); marksP.toggle(); return true; }, { scene: uiScene }),
    input.addCloser({
      id: 'marks',
      priority: 955,
      isOpen: anyOpen,
      close: () => { if (walletP.isOpen) walletP.close(); else marksP.close(); },
      scene: uiScene,
    }),
  ];
  if (uiScene.pname) marks.seed(uiScene.pname);

  const api = {
    marks: marksP, wallet: walletP, anyOpen,
    destroy() { offs.forEach((o) => { try { o(); } catch { /* ignore */ } }); marksP.destroy(); walletP.destroy(); },
  };
  uiScene.events.once('shutdown', () => api.destroy());
  if (typeof window !== 'undefined') window.__marksUI = api;
  return api;
}
