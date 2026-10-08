# Frame packet: 05-matchups

## Project inputs

- Project: D:\ai-studio\wayfarer-online\videos\wayfarer-promo
- Design tokens: D:\ai-studio\wayfarer-online\videos\wayfarer-promo\frame.md
- RULES_DIR: C:\Users\vclin_jjufoql\.claude\skills\hyperframes-animation\rules

## Assigned storyboard block

## Frame 5 — Player or agent. Your call.

- scene: A paired split — one side a human duelist, the other an agent silhouette with the same sprite — both squaring off in the shared open world.
- duration: 4.8s
- transition_in: push-slide LEFT
- status: outline
- voiceover: "Duel another player. Or duel their agent. Same arena, same stakes."
- src: compositions/frames/05-matchups.html
- type: benefit_highlight
- persuasion: Negative contrast
- beat: excitement
- blueprint: comparison-split
- asset_candidates: assets/01-town-crowded.jpg — reuse the ambiguous crowd as the "could be either" texture for both panel halves

narrativeRole: States the actual shipped breadth of matchmaking (human-vs-human is already the base game; this frame's job is agent-vs-player and agent-vs-agent specifically) as the clearest, most concrete expression of "agent-vs-player and agent-vs-agent."
keyMessage: Every kind of opponent is on the table — including someone else's agent.

blueprint: comparison-split (Reproduce) — two paired capabilities of equal weight, exactly the blueprint's intent (a human opponent vs. an agent opponent), shown simultaneously not sequentially.
focal: assets/01-town-crowded.jpg
roles: assets/01-town-crowded.jpg = source for both card cutouts — two different character crops from the same real screenshot, underlining that they're visually identical

Scene 1 (0.0–0.8s): as the VO begins "Duel another player," a centered title line with accent keyword "SAME ARENA" slides down into place from just above — a smooth settle, forming the T-shape against the cards to come.
Scene 2 (0.8–2.2s): two equal-width cards arrive from opposite wings with mirrored rotateY book-open tilts — left card crops one character from assets/01-town-crowded.jpg labeled "PLAYER" (mono chip), right card crops a different character from the same source labeled "AGENT" (mono chip); both read as the same kind of sprite.
Scene 3 (2.2–4.8s): as the VO lands "or duel their agent. Same arena, same stakes," a pill badge lands at each card's inner edge ("PvP" left, "PvA" right, ~0.3s apart) — the shot's one earned overshoot — settles and holds; gentle phase-opposed idle float (never synchronized) per the blueprint's sanctioned subtle jitter.

## Selected blueprint: comparison-split

# comparison-split — Comparison Split-Cards

**intent**: Two paired items of equal weight shown side-by-side with mirrored 3D "book-open" tilts — the eye reads them as a balanced comparison, then a pill badge lands at each card's inner edge to punctuate. The motion IS the symmetry: two cards arriving from opposite wings into a held spread.

**roles served**

- Key_Feature (from `comparison-split-cards`): when two complementary features / capabilities of equal weight should be presented **simultaneously, not sequentially** — an A/B, a "X + Y together," paired concepts the viewer must weigh side-by-side. Not for >2 items (use `grid-card-assemble`) or sequential steps.

**duration**: 4–6s

**shot structure** (a `[bg]` canvas carrying two faint ambient glow blooms — `[accent A]` near 30%, `[accent B]` near 70% — so each side owns a color identity across a 50% symmetry axis; equal-width cards under one shared perspective parent)

- **Scene 1 (0.0–~0.8s) — title sets the concept.** A centered `[title line]` with an `[accent keyword]` slides DOWN into place from just above (a short smooth settle). The downward arrival is deliberate: it forms a non-conflicting T-shape against the cards, which arrive from the sides next.
- **Scene 2 (~0.4–1.9s) — the split-tilt entry (signature move).** Two equal-width feature cards arrive from opposite wings — `[left card]` from the left, `[right card]` from the right ~0.2s behind — each carrying a **mirrored 3D `rotateY` tilt** (left faces right, right faces left, opening like a book) and scaling ~0.85→1 as it lands. The entry overlaps the title's tail so the whole thing reads as ONE arrival, not two beats. Each card holds `[image / label / subtitle]`; box-shadows fall **outward** from the tilt (left shadow right, right shadow left).
- **Scene 3 (~1.9–end) — badges punctuate, then hold.** A pill `[badge]` lands at each card's **inner edge** (left then right, ~0.3s apart), overlapping its card ~15% so it reads as attached, not orbiting. This is the lone overshoot in the shot — it earns the punctuation. Settles and holds.

**motion vocabulary**: title slide-down from above; mirrored opposite-wing card entry; static book-open `rotateY` tilt (`+tilt` left, `−tilt` right); tilt-matched outward box-shadow; inner-edge badge spring-pop; gentle phase-opposed idle float (left vs right, never synchronized) registered as subtle jitter; dual side-glow ambient.

**rule mapping**

- two cards entering from opposite wings with mirrored `rotateY` tilts + tilt-matched shadow → `split-tilt-cards` (the signature; keep the two-layer split so the entry `x`/`scale` and the idle never collide on one alias)
- title slide-down settle → `gsap-effects` (translate + opacity on a long-tail `power3`)
- inner-edge pill badge pop (the one overshoot) → `spring-pop-entrance` (overshoot register — earns the punctuation)
- phase-opposed idle float on the pair → `sine-wave-loop` (low-amplitude register — subtle jitter, NOT lazy breathing; left `sin(t)`, right `sin(t+π)` so they never conveyor-belt)
- the two faint side glows behind the cards → `ambient-glow-bloom` (un-triggered soft bloom, one per accent)

**camera modifier**: camera-static by default — the symmetry is the subject and a move would break the balance.
