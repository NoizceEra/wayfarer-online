// Full-screen DOM loading veil (#splash in index.html): the boot splash AND the "preparing the world" card
// shown when a slow asset preload is still running as the player starts a journey / travels.
const $ = (id) => document.getElementById(id);
const TIPS = [
  'Tip: Skills 1-6 sit on the number keys. Press H any time for all hotkeys.',
  'Tip: Waystones let you fast travel once attuned.',
  'Tip: Gather herbs and ore, then craft gear at a workbench.',
  'Tip: N opens the world map, L the quest journal, I your bag.',
  'Tip: Potions are on Q. Keep a few in your bag before heading into a dungeon.',
  'Tip: Rest at the inn to heal fully and skip to morning.',
  'Tip: Play Online to meet other wayfarers, or host a co-op room for friends.',
  'Tip: Talk to everyone. Townsfolk hand out quests and rumours.',
  'Tip: Low on performance? Open the menu and set Effects quality to Low.',
];
let tipTimer = null, hideTimer = null;

function startTips() {
  const tipEl = $('splash-tip');
  if (!tipEl || tipTimer) return;
  const tips = TIPS.slice().sort(() => Math.random() - 0.5);
  let i = 0;
  const next = () => { tipEl.textContent = tips[i++ % tips.length]; };
  next();
  tipTimer = setInterval(next, 2600);
}

export const veil = {
  show(label = 'LOADING') {
    const sp = $('splash'); if (!sp) return;
    clearTimeout(hideTimer);
    sp.style.display = 'flex';
    void sp.offsetWidth; // restart the fade-in
    sp.classList.remove('out');
    this.label = label;
    startTips();
  },
  progress(v) {
    const p = Math.max(0, Math.min(1, v));
    const bar = $('splash-bar'), pct = $('splash-pct');
    if (bar) bar.style.width = `${Math.max(4, Math.round(p * 100))}%`;
    if (pct) pct.textContent = `${this.label || 'LOADING'} ${Math.round(p * 100)}%`;
  },
  hide() {
    const sp = $('splash'); if (!sp) return;
    clearInterval(tipTimer); tipTimer = null;
    sp.classList.add('out');
    hideTimer = setTimeout(() => { sp.style.display = 'none'; }, 450);
  },
};
