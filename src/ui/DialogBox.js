import { audio } from '../systems/audio.js';

const FONT = '"Silkscreen", monospace';

// NPC dialogue panel used by OverlayScene.drawDialog: optional 76px portrait
// (Faceset 38x38 at 2x), name + title plate, typewriter body text, option list.
// Pressing confirm while typing completes the line first (see `skip`).
// d = { name, title?, face?, text, options, danger, t0 }  (d.typed is managed here)
export const DialogBox = {
  draw(scene, container, d, W, H, onPick) {
    const pw = Math.min(W - 24, 480);
    const hasFace = !!(d.face && scene.textures.exists(d.face));
    const fs = 76;
    const textX = hasFace ? -pw / 2 + 14 + fs + 12 : -pw / 2 + 14;
    const tw = pw - (textX + pw / 2) - 14;
    const opts = d.options.length ? d.options : [{ label: 'OK' }];
    const body = scene.add.text(textX, 0, d.text, { fontFamily: FONT, fontSize: '11px', color: '#f4e8c8', wordWrap: { width: tw }, lineSpacing: 4 });
    const th = body.height;
    const topH = Math.max(th + 30, hasFace ? fs + 26 : 0);
    const ph = topH + 10 + opts.length * 26 + 10;
    const bg = scene.add.rectangle(0, 0, pw, ph, 0x2a1d10, 0.96).setStrokeStyle(2, d.danger ? 0xe74c3c : 0x8d5a2b);
    const nm = scene.add.text(textX, -ph / 2 + 10, d.name, { fontFamily: FONT, fontSize: '12px', color: d.danger ? '#ff8a7a' : '#f4c542', fontStyle: 'bold' });
    container.add([bg, nm]);
    if (d.title) container.add(scene.add.text(nm.x + nm.width + 8, -ph / 2 + 12, d.title, { fontFamily: FONT, fontSize: '9px', color: '#b9a57a' }));
    if (hasFace) {
      const fx = -pw / 2 + 14 + fs / 2, fy = -ph / 2 + 12 + fs / 2;
      container.add(scene.add.rectangle(fx, fy, fs + 6, fs + 6, 0x120c06, 1).setStrokeStyle(2, 0x8d5a2b));
      container.add(scene.add.image(fx, fy, d.face).setScale(2));
    }
    body.setPosition(textX, -ph / 2 + 30);
    container.add(body);
    // typewriter
    const full = d.text;
    if (d.typed === undefined) d.typed = 0;
    body.setText(full.slice(0, d.typed));
    d.body = body; d.full = full;
    if (d.typed < full.length) {
      d.timer?.remove();
      d.timer = scene.time.addEvent({
        delay: 20, loop: true, callback: () => {
          d.typed = Math.min(full.length, d.typed + 1);
          body.setText(full.slice(0, d.typed));
          if (d.typed % 3 === 0 && full[d.typed - 1] !== ' ') audio.blip?.(380 + Math.random() * 120, 0.03, 'square', 0.02);
          if (d.typed >= full.length) d.timer.remove();
        },
      });
    }
    opts.forEach((o, i) => {
      const y = -ph / 2 + topH + 10 + i * 26 + 11;
      const b = scene.add.rectangle(0, y, pw - 24, 22, 0x4a3219, 1).setStrokeStyle(1, 0x8d5a2b).setInteractive({ useHandCursor: true });
      const t = scene.add.text(-pw / 2 + 22, y, `${d.options.length ? `${i + 1}.  ` : ''}${o.label}`, { fontFamily: FONT, fontSize: '11px', color: '#ffe8a0' }).setOrigin(0, 0.5);
      b.on('pointerover', () => b.setFillStyle(0x6b4a26));
      b.on('pointerout', () => b.setFillStyle(0x4a3219));
      b.on('pointerdown', (p, lx, ly, ev) => { ev?.stopPropagation?.(); if (scene.time.now - d.t0 > 120) onPick(i); });
      container.add([b, t]);
    });
    container.setPosition(W / 2, H - ph / 2 - 100).setVisible(true);
  },
  // If the line is still being typed, finish it and return true (consumes the key press).
  skip(d) {
    if (!d || d.typed === undefined || d.typed >= (d.full || '').length) return false;
    d.timer?.remove();
    d.typed = d.full.length;
    d.body?.setText(d.full);
    return true;
  },
  stop(d) { d?.timer?.remove(); },
};
