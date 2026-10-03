// Pet Master NPC + "The Wandering Hatchery" quest integration
// Purely additive. Uses questSystem registerNpc/talk, items from data/items.js,
// materials from data/materials.js, and pet sprites from data/pets.js.
import { bus, Events } from '../core/events.js';
import { CONFIG } from '../config.js';
import { baseFor, makePet, PETS } from '../data/pets.js';
import { giveItem } from '../data/items.js';

const FONT = '"Silkscreen", monospace';

// Coordinates in Thistle Town, near the notice board (spawn-relative).
// spawn is at the town plaza; notice board is roughly spawn.x - 118, spawn.y - 22.
export const PET_MASTER = {
  name: 'Pet Master Li',
  tex: 'OldMan',
  dx: -158,
  dy: -20,
};
void CONFIG; // config imported for future tile/grid use

export function spawnPetMaster(scene) {
  const x = scene.spawn.x + PET_MASTER.dx;
  const y = scene.spawn.y + PET_MASTER.dy;
  const c = scene.add.container(x, y);
  const sh = scene.add.image(0, 3, 'char.shadow').setScale(1.4, 1);
  const b = scene.add.sprite(0, -8, `char.${PET_MASTER.tex}`, 0);
  const idle = `char.${PET_MASTER.tex}.idle.down`;
  if (scene.anims.exists(idle)) b.play(idle);
  const l = scene.add.text(0, -26, PET_MASTER.name, {
    fontFamily: FONT, fontSize: '8px', color: '#fff', backgroundColor: '#00000088',
  }).setOrigin(0.5);
  c.add([sh, b, l]);
  c.setDepth(c.y);
  c.setData('def', { name: PET_MASTER.name, shop: null, text: 'Every Wayfarer needs a companion.' });
  scene.npcs.push(c);
  scene.quests.registerNpc(PET_MASTER.name, c, null);
  return c;
}

// Hook into the questSystem NPC talk pipeline.
// Returns true if the Pet Master dialogue handled this interaction.
export function onPetMasterTalk(scene, name, fallback) {
  if (name !== PET_MASTER.name) return false;

  const pets = scene.meta.pets || (scene.meta.pets = { unlocked: false, roster: [] });

  // If quest not yet accepted/complete, defer to the normal quest dialog.
  if (!scene.quests.isActive('q_pet_unlock') && !scene.quests.isDone('q_pet_unlock')) {
    return false;
  }

  // Active quest: show reminder or check completion (materials).
  if (scene.quests.isActive('q_pet_unlock')) {
    const ready = scene.quests.isReady('q_pet_unlock');
    if (ready) {
      showStarterChoice(scene, (choice) => {
        if (!choice) return;
        // grant chosen starter egg item
        giveItem(scene, `pet_egg_${choice}`, 1);
        // complete the quest (consumes sunpetal/moonmoss)
        scene.quests.complete('q_pet_unlock');
        // unlock and add starter to roster
        pets.unlocked = true;
        const pet = makePet(choice, 5);
        if (pet) pets.roster.push(pet);
        bus.emit(Events.SYSTEM, `The ${PETS[choice].name} egg hatches! You now have a companion.`);
        bus.emit(Events.TOAST, { title: 'Pet unlocked', text: `${PETS[choice].name} joined you!`, color: '#ffd84a' });
        scene.saveNow();
      });
      return true;
    }
    say(scene, PET_MASTER.name,
      'I need one Sunpetal and one Moonmoss to wake the egg. Meadow flowers and Mosswood moss should do.',
      [{ label: 'I will find them', cb: fallback || (() => {}) }]
    );
    return true;
  }

  // Quest done: post-unlock chat + roster summary.
  const roster = pets.roster || [];
  const names = roster.length
    ? roster.map((p) => baseFor(p.id)?.name || p.id).join(', ')
    : 'none yet';
  say(scene, PET_MASTER.name,
    `Your companions are doing well: ${names}. Feed them, let them fight beside you, and they will grow.`,
    [{ label: 'Farewell', cb: fallback || (() => {}) }]
  );
  return true;
}

// Simple Phaser container-based choice UI for picking a starter egg.
export function showStarterChoice(scene, callback) {
  const W = 220, H = 150;
  const cx = scene.cameras.main.midPoint.x;
  const cy = scene.cameras.main.midPoint.y - 40;
  const bg = scene.add.rectangle(cx, cy, W, H, 0x1a120b, 0.95)
    .setStrokeStyle(2, 0xffd84a).setDepth(3000).setScrollFactor(0);
  const title = scene.add.text(cx, cy - H / 2 + 14, 'Choose a starter egg', {
    fontFamily: FONT, fontSize: '12px', color: '#ffd84a',
  }).setOrigin(0.5).setDepth(3001).setScrollFactor(0);

  const choices = [
    { id: 'emberling', label: 'Emberling (Fire)' },
    { id: 'dewdrop',   label: 'Dewdrop (Water)' },
    { id: 'sprig',     label: 'Sprig (Nature)' },
  ];
  let chosen = null;
  const items = [];
  const startY = cy - H / 2 + 44;
  for (let i = 0; i < choices.length; i++) {
    const ch = choices[i];
    const y = startY + i * 30;
    const box = scene.add.rectangle(cx, y, W - 24, 24, 0x2a2015, 1)
      .setStrokeStyle(1, 0x5a4a3a).setDepth(3001).setScrollFactor(0).setInteractive();
    const txt = scene.add.text(cx - W / 2 + 18, y, ch.label, {
      fontFamily: FONT, fontSize: '10px', color: '#fff',
    }).setOrigin(0, 0.5).setDepth(3002).setScrollFactor(0);
    box.on('pointerdown', () => {
      chosen = ch.id;
      for (const b of items) b.setFillStyle(0x2a2015);
      box.setFillStyle(0x4a3a22);
    });
    items.push(box);
    items.push(txt);
  }

  const ok = scene.add.text(cx, cy + H / 2 - 18, '[ OK ]', {
    fontFamily: FONT, fontSize: '10px', color: chosen ? '#ffd84a' : '#888',
  }).setOrigin(0.5).setDepth(3002).setScrollFactor(0).setInteractive();
  ok.on('pointerdown', () => {
    if (!chosen) return;
    destroyUI([bg, title, ok, ...items]);
    callback(chosen);
  });

  // close on Escape or outside click
  const blocker = scene.add.rectangle(cx, cy, W + 400, H + 400, 0x000000, 0.01)
    .setDepth(2999).setScrollFactor(0).setInteractive();
  blocker.on('pointerdown', () => {
    destroyUI([bg, title, ok, blocker, ...items]);
    callback(null);
  });
  items.push(blocker);
}

function destroyUI(list) {
  for (const o of list) if (o && o.active !== false) o.destroy();
}

function say(scene, name, text, opts) {
  // Prefer the AreaManager say if it exists, else system fallback.
  if (scene.areas?.say) {
    scene.areas.say(name, text, opts);
  } else {
    bus.emit(Events.SYSTEM, `${name}: ${text}`);
    if (opts?.[0]?.cb) opts[0].cb();
  }
}

// Quest reward hook used by data/quests.js `q_pet_unlock` if its reward.fn exists.
// Kept as a callable for custom reward fields (questSystem.grant does not invoke
// functions by default, so we wire this from the turn-in path in onPetMasterTalk).
export function grantStarterReward(scene, eggId) {
  const pets = scene.meta.pets || (scene.meta.pets = { unlocked: false, roster: [] });
  pets.unlocked = true;
  const pet = makePet(eggId, 5);
  if (pet) pets.roster.push(pet);
  scene.saveNow();
  return pet;
}
