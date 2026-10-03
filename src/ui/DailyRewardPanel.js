// Pixel-styled daily reward card. Mirrors MailPanel lifecycle but renders a
// 7-day strip and a big streak counter in the Solana palette.
import { bus, Events } from '../core/events.js';
import { audio } from '../systems/audio.js';
import { socialRoot, el, escapeHtml } from './socialDom.js';

const PALETTE = {
  bg: '#0a0e1a',
  green: '#14f195',
  purple: '#9945ff',
  cyan: '#03e1ff',
  white: '#e1e8f0',
  muted: '#6b7a99',
  gold: '#ffd84a',
};

let cssDone = false;
function injectCss() {
  if (cssDone) return; cssDone = true;
  const s = el('style');
  s.textContent = `
#wf-social .dr-panel{left:50%;top:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;width:min(400px,calc(100vw - 16px));max-height:86vh;background:rgba(10,14,26,.96);border:2px solid #9945ff;box-shadow:0 0 12px rgba(153,69,255,.35),inset 0 0 0 1px #03e1ff}
#wf-social .dr-title{color:#e1e8f0;font-size:12px;padding:6px 10px;border-bottom:1px solid #9945ff;display:flex;align-items:center;gap:8px;background:#0a0e1a}
#wf-social .dr-title span{color:#14f195}
#wf-social .dr-x{margin-left:auto;background:transparent;border:0;color:#e1e8f0;font-size:12px;cursor:pointer}
#wf-social .dr-x:hover{color:#03e1ff}
#wf-social .dr-body{padding:10px;overflow-y:auto;flex:1}
#wf-social .dr-streak{text-align:center;margin:8px 0 14px}
#wf-social .dr-streak-n{font-size:42px;color:#14f195;text-shadow:0 0 8px rgba(20,241,149,.45);line-height:1}
#wf-social .dr-streak-l{font-size:10px;color:#6b7a99;margin-top:2px}
#wf-social .dr-strip{display:flex;gap:4px;justify-content:center;margin-bottom:12px}
#wf-social .dr-day{flex:1;min-width:0;border:1px solid #3a3f55;background:#0f1320;padding:6px 2px;text-align:center;position:relative}
#wf-social .dr-day.today{border-color:#9945ff;box-shadow:0 0 8px rgba(153,69,255,.35)}
#wf-social .dr-day.claimed{border-color:#14f195}
#wf-social .dr-day .dr-d{font-size:9px;color:#6b7a99}
#wf-social .dr-day.today .dr-d{color:#03e1ff}
#wf-social .dr-day .dr-g{font-size:11px;color:#ffd84a;margin:4px 0}
#wf-social .dr-day .dr-t{font-size:8px;color:#9945ff}
#wf-social .dr-day .dr-check{font-size:12px;color:#14f195;margin-top:2px}
#wf-social .dr-foot{display:flex;gap:8px;padding:10px;border-top:1px solid #3a3f55;align-items:center;justify-content:center}
#wf-social .dr-foot button{font-size:11px;padding:6px 18px;background:#14f195;color:#0a0e1a;border:1px solid #03e1ff;cursor:pointer}
#wf-social .dr-foot button:hover{background:#03e1ff}
#wf-social .dr-foot button:disabled{background:#1a1f33;color:#6b7a99;border-color:#3a3f55;cursor:default}
#wf-social .dr-note{text-align:center;font-size:9px;color:#6b7a99;margin-top:6px}
@media (max-width:560px){#wf-social .dr-panel{max-height:78vh}#wf-social .dr-strip{gap:2px}#wf-social .dr-day{padding:5px 1px}#wf-social .dr-day .dr-g{font-size:9px}}
`;
  document.head.appendChild(s);
}

function panel(onClose) {
  injectCss();
  const root = socialRoot();
  const p = el('div', 'wf-panel dr-panel');
  p.style.display = 'none';
  p.addEventListener('pointerdown', (e) => e.stopPropagation());
  const t = el('div', 'dr-title', '<span>⭐</span> DAILY REWARD');
  const x = el('button', 'dr-x', '✕');
  x.addEventListener('click', onClose);
  t.appendChild(x);
  p.appendChild(t);
  root.appendChild(p);
  return p;
}

export class DailyRewardPanel {
  constructor() {
    this.el = panel(() => this.close());
    this.body = el('div', 'dr-body');
    this.foot = el('div', 'dr-foot');
    this.el.append(this.body, this.foot);
    this.system = null;
    this.claimBtn = null;

    this.off = bus.on(Events.DAILY_REWARD, (e) => {
      if (e?.claimed && this.isOpen) this.render();
    });
  }

  get isOpen() { return this.el.style.display !== 'none'; }

  open(scene, system) {
    this.scene = scene;
    this.system = system;
    this.el.style.display = 'flex';
    this.render();
  }

  close() {
    this.el.style.display = 'none';
  }

  toggle(scene, system) {
    if (this.isOpen) this.close();
    else this.open(scene, system);
  }

  destroy() {
    this.close();
    this.off?.();
    this.el.remove();
  }

  render() {
    if (!this.system) return;
    const { today, claimed, streak, rewards } = this.system.preview();
    const currentDay = Math.max(1, Math.min(streak, rewards.length));

    const streakN = el('div', 'dr-streak-n', String(streak));
    const streakL = el('div', 'dr-streak-l', streak === 1 ? '1-DAY STREAK' : `${streak}-DAY STREAK`);
    const streakWrap = el('div', 'dr-streak');
    streakWrap.append(streakN, streakL);

    const strip = el('div', 'dr-strip');
    for (const r of rewards) {
      const isToday = r.day === currentDay && !claimed && streak <= 7;
      const isClaimed = this.system.daily.claimedDays?.[today] && r.day === currentDay;
      const dayEl = el('div', `dr-day${isToday ? ' today' : ''}${isClaimed ? ' claimed' : ''}`);
      dayEl.innerHTML = `<div class="dr-d">DAY ${r.day}</div><div class="dr-g">${r.gold}g</div>${r.tokens ? `<div class="dr-t">+${r.tokens} TP</div>` : ''}${isClaimed ? '<div class="dr-check">✓</div>' : ''}`;
      strip.appendChild(dayEl);
    }

    this.body.innerHTML = '';
    this.body.append(streakWrap, strip);
    if (claimed) {
      const note = el('div', 'dr-note', `Come back tomorrow for Day ${Math.min(currentDay + 1, 7)} rewards.`);
      this.body.appendChild(note);
    } else {
      const note = el('div', 'dr-note', 'Claim before UTC midnight to keep your streak alive.');
      this.body.appendChild(note);
    }

    this.foot.innerHTML = '';
    const btn = el('button', '', claimed ? 'ALREADY CLAIMED' : 'CLAIM');
    btn.disabled = claimed;
    if (!claimed) {
      btn.addEventListener('click', () => {
        audio.play('ui', 0.7);
        this.system.claimToday();
      });
    }
    this.claimBtn = btn;
    this.foot.appendChild(btn);
  }
}
