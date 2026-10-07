// DOM install affordance for the Wayfarer Online PWA (ui/PwaInstall.js).
//
// Why DOM and not a Phaser object: the deferred `beforeinstallprompt().prompt()`
// call is only honoured inside a *real* user gesture, so the trigger has to be a
// genuine HTML element the browser can attribute the click to.
//
// Behaviour
//   * captures `beforeinstallprompt` and shows a small "Install" pill ONLY while
//     an install prompt is actually available;
//   * a click calls prompt() once and hides the pill on acceptance;
//   * hides for good on `appinstalled`, and never shows when the app is already
//     running installed (`display-mode: standalone` / iOS `navigator.standalone`);
//   * stays hidden while the title/login scene is on screen -- the Phaser title
//     scene owns the login name field and already offers its own install button,
//     so this DOM pill can never cover the login UI.
//
// The pill sits at z-index 8: above the game canvas (z 1) but below the boot
// splash (z 10), so it is invisible until the splash clears.

const BTN_ID = 'wf-pwa-install';

let deferred = null;   // the captured BeforeInstallPromptEvent
let btn = null;        // the pill element, created lazily on first prompt
let installed = false; // latched once appinstalled fires
let poll = null;       // lightweight scene watcher (only while a prompt is pending)

function alreadyInstalled() {
  try {
    const mq = window.matchMedia;
    return !!(
      (mq && mq('(display-mode: standalone)').matches) ||
      (mq && mq('(display-mode: fullscreen)').matches) ||
      window.navigator.standalone === true
    );
  } catch {
    return false;
  }
}

// The Phaser "title" scene is the login screen (wayfarer name field + Play buttons).
function onLoginScreen() {
  const game = window.__wayfarer;
  return !!(game && game.scene && typeof game.scene.isActive === 'function' && game.scene.isActive('title'));
}

function buildButton() {
  if (btn || typeof document === 'undefined' || !document.body) return btn;
  btn = document.createElement('button');
  btn.id = BTN_ID;
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Install Wayfarer Online');
  btn.innerHTML = '<span aria-hidden="true">\u2b07</span> Install';
  // Inline styles: dependency-free and isolated from the game's own UI/CSS work.
  Object.assign(btn.style, {
    position: 'fixed',
    right: 'max(12px, env(safe-area-inset-right))',
    bottom: 'max(12px, env(safe-area-inset-bottom))',
    zIndex: '8',
    display: 'none',
    alignItems: 'center',
    gap: '6px',
    padding: '9px 14px',
    margin: '0',
    font: '700 13px/1 "Silkscreen", monospace',
    letterSpacing: '1px',
    color: '#0A0E1A',
    background: '#14F195',
    border: '2px solid #03E1FF',
    borderRadius: '6px',
    boxShadow: '0 4px 0 rgba(3,225,255,0.35)',
    cursor: 'pointer',
    appearance: 'none',
    WebkitAppearance: 'none',
    WebkitTapHighlightColor: 'transparent',
    touchAction: 'manipulation',
  });
  btn.addEventListener('click', () => { triggerInstall(); });
  document.body.appendChild(btn);
  return btn;
}

function shouldShow() {
  return !installed && !alreadyInstalled() && !!deferred && !onLoginScreen();
}

function reconcile() {
  if (!btn) return;
  const show = shouldShow();
  btn.style.display = show ? 'inline-flex' : 'none';
  btn.setAttribute('aria-hidden', show ? 'false' : 'true');
}

function destroy() {
  if (poll) { clearInterval(poll); poll = null; }
  if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
  btn = null;
}

async function triggerInstall() {
  if (!deferred) return;
  const evt = deferred;
  deferred = null; // a BeforeInstallPromptEvent can only be prompted once
  try {
    evt.prompt();
    const choice = await (evt.userChoice || Promise.resolve(null));
    if (choice && choice.outcome === 'accepted') installed = true;
  } catch (err) {
    // prompt() rejects if the event was already consumed or the gesture was lost.
    console.warn('pwa install prompt failed', err && err.message ? err.message : err);
  }
  reconcile();
}

function onBeforeInstallPrompt(e) {
  e.preventDefault(); // suppress the browser mini-infobar; we control the timing
  deferred = e;
  buildButton();
  reconcile();
}

function onAppInstalled() {
  installed = true;
  deferred = null;
  destroy();
}

export function installPwaInstall() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  window.addEventListener('appinstalled', onAppInstalled);
  // The pill can only appear once the player has left the login screen; a light
  // watcher re-evaluates on scene changes (it does nothing until a prompt exists).
  if (!poll) poll = setInterval(() => { if (deferred) reconcile(); }, 1000);
}
