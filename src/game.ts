import type { Game, CueSpec } from "@clockwyrks/simple-2d";
import * as C from "./constants";
import type { FathomDebugApi, FathomState } from "./types";
import { debug } from "./debug";
import { initial } from "./world";
import { input } from "./menus";
import { advance } from "./simulation";
import { render } from "./render";

export type * from "./types";
export type { PredatorKind } from "./constants";
export const BACKGROUND = "#02090e";

const SHEETS: Record<string, number> = {
  glimmerfin: 8,
  lanternjaw: 16,
  gloamfin: 8,
  flarefish: 8,
  drifter: 8,
  "flare-bloom": 8,
  "trench-walls": 19,
};
const SOUNDS: Record<C.CueName, CueSpec> = {
  [C.CUES.eat]: {
    wave: "sine",
    freq: 700,
    freqTo: 1100,
    gain: 0.055,
    durationMs: 65,
  },
  [C.CUES.sonar]: {
    wave: "sine",
    freq: 960,
    freqTo: 180,
    gain: 0.14,
    durationMs: 520,
  },
  [C.CUES.ink]: {
    wave: "triangle",
    freq: 90,
    freqTo: 35,
    gain: 0.16,
    durationMs: 450,
  },
  [C.CUES.predatorPing]: {
    wave: "sine",
    freq: 330,
    freqTo: 820,
    gain: 0.11,
    durationMs: 400,
  },
  [C.CUES.flare]: {
    wave: "sawtooth",
    freq: 100,
    freqTo: 550,
    gain: 0.065,
    durationMs: 600,
  },
  [C.CUES.caught]: {
    wave: "triangle",
    freq: 420,
    freqTo: 42,
    gain: 0.2,
    durationMs: 650,
  },
  [C.CUES.descend]: {
    wave: "sine",
    freq: 160,
    freqTo: 980,
    gain: 0.16,
    durationMs: 850,
  },
};

export const game: Game<FathomState, FathomDebugApi> = {
  async initialize(api) {
    for (const name of C.ACTIONS)
      api.input.register(name, { keys: [...C.BINDINGS[name]] });
    for (const cue of Object.values(C.CUES)) api.audio.define(cue, SOUNDS[cue]);
    const sheets = await Promise.all(
      Object.entries(SHEETS).map(
        async ([name, count]) =>
          [
            name,
            await Promise.all(
              Array.from({ length: count }, (_, i) =>
                api.assets.loadImage(`${name}/${i}.png`),
              ),
            ),
          ] as const,
      ),
    );
    for (const field of [
      "screen",
      "depth",
      "score",
      "lives",
      "brightness",
      "visionRadius",
      "windowRadius",
      "planktonRemaining",
    ] as const)
      api.diagnostics.register(field, (s) => s[field]);
    api.diagnostics.register("sonar cooldown", (s) => s.sonar.cooldown);
    api.diagnostics.register("ink cooldown", (s) => s.ink.cooldown);
    api.diagnostics.register(
      "forager",
      (s) => `${s.forager.tx},${s.forager.ty} ${s.forager.dir}`,
    );
    for (let i = 0; i < C.DEN_ORDER.length * C.ROSTER_CAP; i++)
      api.diagnostics.register(`predator ${i}`, (s) => {
        const p = s.predators[i];
        return p
          ? `${p.kind} ${p.state} ${p.tx},${p.ty} ${p.speed.toFixed(1)} alert:${p.alert}`
          : "none";
      });
    return [initial(Object.fromEntries(sheets)), debug];
  },
  update: (state, api, dt) =>
    advance(input(state, api), dt, (cue) => api.audio.play(cue)),
  render: (state, api) => render(state, api.ctx),
};
