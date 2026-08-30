# 火柴三國 unit reference

The battle simulator fields 1,000 soldiers per side. One canvas figure is one soldier or
one equipment piece. Statistics below come from the tuning tables in
[`js/scenarios/sanguo.js`](../js/scenarios/sanguo.js); silhouettes come from
[`js/figure/figure.js`](../js/figure/figure.js).

Distances are world pixels, speeds are pixels per second, and cooldowns are seconds between
attacks. Fatigue and wavering morale can reduce actual movement speed.

| Unit | Role | HP | March / charge / flee | Reach or range | Cooldown | Damage | Characteristics |
|---|---|---:|---:|---:|---:|---:|---|
| Spearmen (槍兵) | Defensive line infantry | 5 | 64 / 96 / 116 | 21 melee | 0.80 | 1 | Balanced frontage; deals 2× damage to cavalry and horse archers. |
| Sword and shield (刀盾兵) | Fast close infantry | 6 | 70 / 104 / 120 | 17 melee | 0.62 | 1 | Shortest reach, but attacks fastest among foot troops and has solid health. |
| Crossbowmen (弩兵) | Long-range missile infantry | 3 | 72 / 72 / 124 | 230 range; retreats inside 60 | 2.10 | 1 | Fires a 520 px/s physical bolt; fragile and gives ground when enemies enter its minimum range. |
| Halberdiers (戟兵) | Anti-cavalry heavy infantry | 5 | 60 / 92 / 112 | 24 melee | 0.90 | 1 | Longest ordinary infantry reach; deals 2.2× damage to cavalry and horse archers. |
| Cavalry (騎兵) | Shock and pursuit | 7 | 132 / 180 / 152 | 20 melee | 0.50 | 2 | Fast, durable, highest routine melee damage; a charge hit knocks its target forward. |
| Horse archers (弓騎兵) | Mobile ranged harassment | 4 | 140 / 150 / 156 | 190 range; retreats inside 55 | 1.80 | 1 | Fires an arcing 390 px/s arrow while not charging and becomes shock cavalry on charge. |
| Catapult (投石車) | Heavy long-range support | 12 | 34 / 34 / 58 | 360 range; retreats inside 120 | 4.20 | 3 | Lobs a visible 235 px/s stone. Impact damages and knocks back enemies in a 54 px radius, falling from 3 damage at the centre to 1 at the edge. |
| Battering ram (衝車) | Durable close assault equipment | 16 | 42 / 58 / 64 | 27 melee | 1.15 | 3 | Highest health, melee reach, and impact damage; currently fights units in open-field battles and has no separate gate-damage rule. |
| Standard bearer (旗手) | Formation identity and morale read | 8 | 62 / 86 / 108 | 18 melee | 0.85 | 1 | Carries 劉 for the player or 曹 for the computer. Every formation block has one bearer; the flag falls permanently when that bearer routs or dies. |
| Tiger and Leopard Cavalry (虎豹騎) | Elite armoured shock cavalry | 10 | 125 / 205 / 160 | 23 melee | 0.46 | 3 | Fastest and hardest cavalry charge, with heavier knockback, striped horse armour, a helmet plume, and a couched lance. Vulnerable to braced spears and halberds. |
| Zhuge Repeaters (諸葛弩) | Elite rapid-fire missile infantry | 4 | 68 / 68 / 118 | 195 range; retreats inside 48 | 0.68 | 1 | Fires the fastest projectile (680 px/s) from a box-magazine repeating crossbow. Its pumping lever and recoil animate on every shot. |
| War Elephants (象兵) | Heavy breakthrough corps | 18 | 54 / 92 / 66 | 31 melee | 1.05 | 4 | Highest HP and melee damage. A charge delivers exceptional knockback; the animated elephant has a faction-armoured blanket, howdah, tusks, and swinging trunk. |

Ranged damage is no longer applied at the moment a weapon fires. Bolts, arrows, repeater
bolts, and stones travel through world space and resolve on collision or ground impact.
Misses therefore land harmlessly, while a catapult stone always produces its area impact.
Every projectile type has a distinct flight silhouette, launch sound, and impact effect.

## Default army composition

Both sides share this 880-figure core:

| Unit | Share | Figures |
|---|---:|---:|
| Spearmen | 24% | 240 |
| Sword and shield | 15% | 150 |
| Crossbowmen | 12% | 120 |
| Halberdiers | 14% | 140 |
| Cavalry | 9% | 90 |
| Horse archers | 7% | 70 |
| Catapults | 3% | 30 |
| Battering rams | 2% | 20 |
| Standard-bearer troop allocation | 2% | 20 |
| **Shared core** | **88%** | **880** |

Each side then adds a 30-elephant breakthrough corps and 90 faction-specific
figures:

| Side | Special corps | Share | Figures |
|---|---|---:|---:|
| Both sides | War Elephants (象兵) | 3% | 30 |
| Player — 劉, green | Zhuge Repeaters (諸葛弩) | 9% | 90 |
| Computer — 曹, blue | Tiger and Leopard Cavalry (虎豹騎) | 9% | 90 |

The composition is divided into 13 formation blocks per side. Polearms and the ram form the
front, sword troops support the centre, crossbows and catapults deploy behind, cavalry splits
between both flanks, horse archers hold the outer wing, elephants mass near the front, and the
faction-specific corps keeps its own lane. The first figure in every block is rendered and
simulated with standard-bearer statistics, replacing one member rather than increasing the
1,000-soldier total. Generals are assigned to a different member. Custom `BattleSetup` records
can change the `elephant`, `hubao`, and `zhuge` shares freely.

All 12 unit types therefore appear in the default simulator battle.

All ordinary armour, shields, horse barding, equipment trim, and formation mass washes use
the side's flag colour. In the default simulator 劉 is green and 曹 is blue.

## Shared battle behavior

- Every unit has block morale, fatigue, formation cohesion, routing, and possible rallying
  near a living general.
- Line, column, wedge, square, and skirmish formations rearrange the same surviving figures.
- Routed soldiers flee toward a world edge. Pursuers inflict one additional damage when
  striking a fleeing target.
- The simulation is deterministic from its seed, army setup, and order log. Visual chatter,
  sound, boiling lines, and flag motion do not consume combat randomness.
