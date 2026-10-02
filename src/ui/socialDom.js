// Shared DOM scaffolding for the social panels (chat, player list, party,
// emote wheel, context menu). They are HTML overlays on top of the Phaser
// canvas: real text input, scrollback and per-span colours come for free, and
// the pixel fonts are already loaded by index.html. #wf-social itself never
// eats pointer events; each panel opts in.
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export function socialRoot() {
  let root = document.getElementById('wf-social');
  if (root) return root;
  root = el('div'); root.id = 'wf-social';
  document.body.appendChild(root);
  injectCss();
  return root;
}

let cssDone = false;
function injectCss() {
  if (cssDone) return; cssDone = true;
  const style = el('style');
  style.textContent = `
#wf-social{position:fixed;inset:0;pointer-events:none;z-index:20;font-family:'Silkscreen',monospace;font-size:10px;color:#f4f0dc;-webkit-user-select:none;user-select:none}
#wf-social *{box-sizing:border-box}
#wf-social .wf-panel{pointer-events:auto;position:absolute;background:rgba(26,16,8,.9);border:2px solid #8a5a2b;box-shadow:inset 0 0 0 1px #3a2410,0 0 0 1px #1a1024;image-rendering:pixelated}
#wf-social button{pointer-events:auto;font-family:inherit;font-size:9px;color:#3a1f00;background:#9bbc0f;border:1px solid #1a1024;box-shadow:inset -1px -1px 0 #6a8a00,inset 1px 1px 0 #c8e040;padding:2px 6px;cursor:pointer;line-height:1.2}
#wf-social button:hover{background:#b8d820}
#wf-social button:active{background:#7a9a0a}
#wf-social button.wf-ghost{background:transparent;color:#c8b890;box-shadow:none;border-color:transparent}
#wf-social button.wf-ghost:hover{color:#fff;background:rgba(255,255,255,.08)}
#wf-social button.wf-danger{background:#e8564a;color:#fff;box-shadow:inset -1px -1px 0 #8a2a20,inset 1px 1px 0 #ff9a90}
#wf-social input{font-family:inherit;font-size:11px;color:#fff6e0;background:#120c06;border:1px solid #8a5a2b;padding:3px 5px;outline:none;pointer-events:auto;-webkit-user-select:text;user-select:text}
#wf-social input:focus{border-color:#ffd84a}
#wf-social .wf-title{color:#ffe8a0;font-size:11px;font-weight:bold;padding:4px 8px;border-bottom:1px solid #3a2410;display:flex;align-items:center;gap:6px}
#wf-social .wf-title .wf-x{margin-left:auto}
#wf-social .wf-scroll{overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#8a5a2b #1a1024}
/* chat */
#wf-social .wf-chat{left:8px;bottom:84px;width:320px;display:flex;flex-direction:column;background:rgba(26,16,8,.78)}
#wf-social .wf-chat.wf-open{background:rgba(26,16,8,.92)}
#wf-social .wf-tabs{display:flex;gap:1px;padding:2px 2px 0;border-bottom:1px solid #3a2410;flex-wrap:wrap}
#wf-social .wf-tabs button{background:transparent;box-shadow:none;border:1px solid transparent;color:#9a8a70;padding:2px 5px;font-size:9px}
#wf-social .wf-tabs button.wf-on{color:#fff;border-color:#8a5a2b;border-bottom-color:transparent;background:rgba(255,255,255,.06)}
#wf-social .wf-tabs button.wf-new{color:#ffd84a}
#wf-social .wf-tabs .wf-right{margin-left:auto;display:flex;gap:1px}
#wf-social .wf-log{height:104px;padding:3px 6px;line-height:1.35;word-break:break-word}
#wf-social .wf-log .l{padding:1px 0}
#wf-social .wf-log .t{color:#8a7a60;margin-right:4px}
#wf-social .wf-log .c{margin-right:4px;opacity:.9}
#wf-social .wf-log .n{cursor:pointer;text-decoration:underline dotted;text-underline-offset:2px}
#wf-social .wf-log .n:hover{color:#fff}
#wf-social .wf-inrow{display:none;align-items:center;gap:4px;padding:3px 4px;border-top:1px solid #3a2410}
#wf-social .wf-chat.wf-open .wf-inrow{display:flex}
#wf-social .wf-inrow .wf-chan{font-size:9px;white-space:nowrap;cursor:pointer}
#wf-social .wf-inrow input{flex:1;min-width:0}
#wf-social .wf-chip{left:8px;bottom:84px;padding:4px 8px;cursor:pointer;color:#c8e040}
#wf-social .wf-hint{font-size:8px;color:#8a7a60;padding:1px 6px 3px}
/* players / party panel */
#wf-social .wf-list{width:300px;max-height:70vh;display:flex;flex-direction:column;left:50%;top:50%;transform:translate(-50%,-50%)}
#wf-social .wf-list .wf-scroll{max-height:52vh}
#wf-social .wf-row{display:flex;align-items:center;gap:6px;padding:3px 8px;border-bottom:1px solid #2a1a0c}
#wf-social .wf-row:hover{background:rgba(255,255,255,.05)}
#wf-social .wf-row .wf-name{font-weight:bold;min-width:80px}
#wf-social .wf-row .wf-meta{color:#b8a888;font-size:9px;flex:1}
#wf-social .wf-row .wf-acts{display:flex;gap:2px}
#wf-social .wf-row .wf-acts button{padding:1px 4px;font-size:8px}
#wf-social .wf-dot{width:6px;height:6px;background:#5a5a5a;display:inline-block}
#wf-social .wf-dot.on{background:#7dff9a}
#wf-social .wf-empty{padding:10px;color:#8a7a60;text-align:center}
#wf-social .wf-foot{display:flex;gap:4px;padding:6px 8px;border-top:1px solid #3a2410;align-items:center;flex-wrap:wrap}
#wf-social .wf-foot input{flex:1;min-width:80px}
/* toast */
#wf-social .wf-toast{left:50%;top:64px;transform:translateX(-50%);padding:6px 10px;display:flex;gap:8px;align-items:center;background:rgba(26,16,8,.95)}
/* context menu */
#wf-social .wf-menu{min-width:130px;padding:2px 0}
#wf-social .wf-menu .wf-mh{padding:3px 8px;color:#ffe8a0;font-weight:bold;border-bottom:1px solid #3a2410}
#wf-social .wf-menu button{display:block;width:100%;text-align:left;background:transparent;box-shadow:none;border:0;color:#f4f0dc;padding:3px 8px;font-size:9px}
#wf-social .wf-menu button:hover{background:#9bbc0f;color:#1a1024}
#wf-social .wf-menu button:disabled{color:#6a5a48;background:transparent;cursor:default}
/* emote wheel */
#wf-social .wf-wheel{pointer-events:auto;position:absolute;left:50%;top:50%;width:0;height:0}
#wf-social .wf-wheel .wf-em{position:absolute;width:52px;height:56px;margin:-28px 0 0 -26px;background:rgba(26,16,8,.92);border:2px solid #8a5a2b;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;cursor:pointer;color:#f4f0dc;font-size:8px;transition:transform .08s}
#wf-social .wf-wheel .wf-em:hover{transform:scale(1.12);border-color:#ffd84a;color:#ffd84a}
#wf-social .wf-wheel .wf-em canvas{image-rendering:pixelated}
#wf-social .wf-wheel .wf-em .k{position:absolute;left:2px;top:1px;color:#ffd84a;font-size:8px}
#wf-social .wf-wheel .wf-center{position:absolute;left:-40px;top:-10px;width:80px;text-align:center;color:#ffe8a0;font-size:9px;pointer-events:none}
#wf-social .wf-shade{pointer-events:auto;position:absolute;inset:0;background:rgba(0,0,0,.25)}
@media (max-width:560px){#wf-social .wf-chat{width:min(340px,calc(100vw - 16px));bottom:190px}#wf-social .wf-log{height:90px;font-size:11px}#wf-social .wf-tabs button{font-size:10px;padding:3px 6px}#wf-social .wf-inrow input{font-size:12px;padding:4px 6px}#wf-social .wf-list{width:min(340px,calc(100vw - 16px))}}
`;
  document.head.appendChild(style);
}

// Position an absolutely-placed element near (x,y), kept inside the viewport.
export function placeAt(node, x, y) {
  node.style.left = '0px'; node.style.top = '0px';
  const r = node.getBoundingClientRect();
  const W = window.innerWidth, H = window.innerHeight;
  node.style.left = `${Math.max(4, Math.min(W - r.width - 4, x))}px`;
  node.style.top = `${Math.max(4, Math.min(H - r.height - 4, y))}px`;
}
