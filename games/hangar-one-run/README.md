# Hangar One Underground

A browser endless runner. You sprint across the tarmac at Moffett Field, down a ramp, and into the utility tunnels that run directly under Hangar One at NASA Ames. A man in a cowboy hat is right behind you.

## Play

Open `index.html` in a browser. There is no build step. Three.js r128 is vendored in `lib/`, so it also works offline (only the web fonts need a network, and they fall back cleanly).

To serve it locally:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Change lane / turn at a junction | ← → or A D | swipe left / right |
| Jump | ↑, W or Space | swipe up |
| Slide (or slam down mid-jump) | ↓ or S | swipe down |
| Pause | P or Esc | II button |
| Mute | M | ♪ button |

## Hazards

- **High voltage**: live cables across the floor (jump), arcs between insulators at head height (slide), sparking switchgear blocking a lane (dodge).
- **Poison gas**: leaking drums fill one or two lanes with green gas (pick another lane).
- **Wasps**: swarms at head height (slide), swarms filling a lane (dodge), and later swarms that drift between lanes.
- **Barricades**: hitting one doesn't kill you, but you stumble and the cowboy catches up. Stumble again while he's close and he lassos you.
- **Junctions**: every tunnel ends in a corner. Turn the way the arrow sign points or you run into the wall.

NASA pins are the coins: 10 points each, plus 1 point per meter. The game speeds up the further you get.

## Files

- `index.html`: page, HUD and menus
- `game.js`: the whole game (procedural tunnels, hazards, characters, synthesized audio)
- `lib/three.min.js`: Three.js r128 (MIT)

`?god=1` turns on a test mode with no deaths and automatic turns.
