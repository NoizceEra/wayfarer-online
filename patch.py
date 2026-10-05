import re

with open('src/data/worldEnemies.js', 'r') as f:
    we = f.read()

we_defs = """
E('crypt_voidwisp', 'Void Wisp', 'crypt_voidwisp', ['crypt', 'hollow'], 92, 19, 42, [5, 12], { items: [{ id: 'hollow_shard', chance: 0.04 }, { id: 'gem_purple', chance: 0.05 }] });
E('forest_briarsapling', 'Briar Sapling', 'forest_briarsapling', ['woods'], 62, 11, 20, [3, 8], { items: [{ id: 'fen_lily', chance: 0.05 }, { id: 'branch', chance: 0.15 }] });
E('frost_rimebat', 'Rime Bat', 'frost_rimebat', ['frost'], 105, 20, 48, [7, 16], { items: [{ id: 'feather', chance: 0.15 }, { id: 'scroll_ice', chance: 0.04 }] });
"""

we = re.sub(
    r"(E\('icegolem'.*?\);)",
    r"\1\n" + we_defs.strip(),
    we
)

we = re.sub(
    r"(\['moss_treant', 4, 'woods'\],)",
    r"\1 ['forest_briarsapling', 5, 'woods'],",
    we
)

we = re.sub(
    r"(AREAS\.crypt\.enemies\.push\(.*?)\);",
    r"\1, ['crypt_voidwisp', 3, 'hall']);",
    we
)

we = re.sub(
    r"(AREAS\.frost\.enemies\.push\(.*?)\);",
    r"\1, ['frost_rimebat', 4, 'field']);",
    we
)

we += "\nAREAS.desert = AREAS.desert || { enemies: [] };"
we += "\nAREAS.desert.enemies = AREAS.desert.enemies || [];"
we += "\nAREAS.desert.enemies.push(['desert_sandstalker', 4, 'any']);"

we += "\nAREAS.caverns = AREAS.caverns || { enemies: [] };"
we += "\nAREAS.caverns.enemies = AREAS.caverns.enemies || [];"
we += "\nAREAS.caverns.enemies.push(['cavern_magmacrab', 4, 'any']);"

we += "\nAREAS.hollow = AREAS.hollow || { enemies: [] };"
we += "\nAREAS.hollow.enemies = AREAS.hollow.enemies || [];"
we += "\nAREAS.hollow.enemies.push(['hollow_abysseye', 4, 'any']);\n"

we_behavs = """
  crypt_voidwisp: { lv: 11, ai: 'ranged', aggro: 120, shot: 0x8a2be2, inflict: { id: 'slow', chance: 0.3 } },
  forest_briarsapling: { lv: 5, ai: 'melee', aggro: 85, inflict: { id: 'poison', chance: 0.2 } },
  frost_rimebat: { lv: 12, ai: 'swarm', aggro: 125, spd: 1.4, inflict: { id: 'slow', chance: 0.25 } },
"""
we = re.sub(
    r"(icegolem:\s*\{.*?\},)",
    r"\1\n" + we_behavs.strip('\n'),
    we
)

with open('src/data/worldEnemies.js', 'w') as f:
    f.write(we)

with open('src/data/enemiesExtra.js', 'r') as f:
    ee = f.read()

ee_desert = "X('desert_sandstalker', 'Sand Stalker', 'desert_sandstalker', ['desert'], 14, 130, 27, 65, [9, 19], { ai: 'swarm', aggro: 110, spd: 1.2, inflict: { id: 'bleed', chance: 0.3 }, items: [{ id: 'sunstone', chance: 0.04 }] });\n"
ee = re.sub(r"(X\('khet'.*?\);)", r"\1\n" + ee_desert, ee, flags=re.DOTALL)

ee_caverns = "X('cavern_magmacrab', 'Magma Crab', 'cavern_magmacrab', ['caverns'], 16, 180, 29, 78, [10, 20], { ai: 'melee', aggro: 90, inflict: { id: 'burn', chance: 0.3 }, items: [{ id: 'fire_crystal', chance: 0.05 }, { id: 'magma_core', chance: 0.03 }] });\n"
ee = re.sub(r"(X\('forgelord'.*?\);)", r"\1\n" + ee_caverns, ee, flags=re.DOTALL)

ee_hollow = "X('hollow_abysseye', 'Abyss Watcher', 'hollow_abysseye', ['hollow'], 13, 140, 24, 58, [9, 18], { ai: 'ranged', aggro: 130, shot: 0x8a2be2, inflict: { id: 'stun', chance: 0.2 }, items: [{ id: 'hollow_shard', chance: 0.05 }] });\n"
ee = re.sub(r"(X\('hking'.*?\);)", r"\1\n" + ee_hollow, ee, flags=re.DOTALL)

with open('src/data/enemiesExtra.js', 'w') as f:
    f.write(ee)

with open('src/data/deathFx.js', 'r') as f:
    dfx = f.read()
dfx_add = "cavern_magmacrab: 'fire', crypt_voidwisp: 'ghost', forest_briarsapling: 'plant', desert_sandstalker: 'bug', frost_rimebat: 'ice', hollow_abysseye: 'ghost',"
dfx = re.sub(r"(glacierwyrm:\s*'ice',)", r"\1\n  " + dfx_add, dfx)
with open('src/data/deathFx.js', 'w') as f:
    f.write(dfx)
