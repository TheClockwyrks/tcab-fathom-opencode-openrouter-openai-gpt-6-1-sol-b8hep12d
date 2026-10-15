import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  SequenceClock,
} from "@clockwyrks/simple-2d";
import type { Engine } from "@clockwyrks/simple-2d";
import { game, BACKGROUND } from "./game";
import type { FathomDebugApi, FathomState, Screen } from "./game";
import * as C from "./constants";
import { debug } from "./debug";
import { advance } from "./simulation";
import {
  center,
  clone,
  DIRECTIONS,
  flood,
  initial,
  layer,
  lineOfSight,
  neighbor,
  put,
  reconcile,
} from "./world";

beforeAll(() => {
  vi.stubGlobal("fetch", async (path: string) => new Response(path));
  vi.stubGlobal("createImageBitmap", async (blob: Blob) =>
    loadImage(new URL(`../${await blob.text()}`, import.meta.url).pathname),
  );
});
const engines: Engine<FathomState, FathomDebugApi>[] = [];
afterEach(() => {
  engines.forEach((e) => e.destroy());
  engines.length = 0;
});
async function harness(
  render = false,
  clock = new ConstantClock(1000 / C.TICK_HZ),
) {
  const canvas = createCanvas(C.STAGE_W, C.STAGE_H);
  const target = new EventTarget();
  const engine = createEngine({
    canvas: canvas as unknown as HTMLCanvasElement,
    game: render ? game : { ...game, render() {} },
    width: C.STAGE_W,
    height: C.STAGE_H,
    background: BACKGROUND,
    layout: C.LAYOUT,
    clock,
    surface: {
      cssWidth: () => C.STAGE_W,
      cssHeight: () => C.STAGE_H,
      dpr: () => 1,
      events: () => target,
    },
  });
  engines.push(engine);
  await engine.initialize();
  const key = (code: string, down = true) => {
    const event = new Event(down ? "keydown" : "keyup");
    Object.assign(event, { code, repeat: false });
    target.dispatchEvent(event);
  };
  const pointer = (type: string, x: number, y: number, device = "mouse") => {
    const event = new Event(type);
    Object.assign(event, {
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: device,
      isPrimary: true,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
    });
    target.dispatchEvent(event);
  };
  return {
    engine,
    key,
    pointer,
    d: engine.debug,
    pose: engine.apply.bind(engine),
  };
}
function fixture(): FathomState {
  let s = initial();
  const rows = layer("#");
  for (let y = 1; y < C.GRID_ROWS - 1; y++)
    for (let x = 1; x < C.GRID_COLS - 1; x++) put(rows, x, y, ".");
  s = debug.setMaze(s, rows);
  s = debug.clearPlankton(s);
  s = debug.clearPredators(s);
  s = debug.setForagerTile(s, 6, 8);
  return debug.setScreen(s, "playing");
}

describe("laid-out maze", () => {
  it("is connected, symmetric, one tile wide, enclosed, and has no dead ends", () => {
    const s = initial();
    const visited = flood(s, s.start);
    let corridors = 0;
    for (let y = 0; y < C.GRID_ROWS; y++)
      for (let x = 0; x < C.GRID_COLS; x++) {
        const char = s.tiles[y][x];
        const mirror = s.tiles[y][C.GRID_COLS - 1 - x];
        if (!"dg".includes(char) && !"dg".includes(mirror))
          expect(char).toBe(mirror);
        if (char !== ".") continue;
        corridors++;
        expect(visited.has(`${x},${y}`)).toBe(true);
        expect(
          DIRECTIONS.filter((d) => neighbor(s, { tx: x, ty: y }, d)).length,
        ).toBeGreaterThanOrEqual(2);
        expect(
          [
            s.tiles[y]?.[x + 1],
            s.tiles[y + 1]?.[x],
            s.tiles[y + 1]?.[x + 1],
          ].every((c) => c === "."),
        ).toBe(false);
        if (x === 0 || x === C.GRID_COLS - 1) expect(y).toBe(10);
        expect(y !== 0 && y !== C.GRID_ROWS - 1).toBe(true);
      }
    expect(visited.size).toBe(corridors);
    const all = flood(s, s.start, true);
    expect(all.size).toBe(corridors + 13);
    for (let y = 7; y <= 9; y++)
      for (let x = 16; x <= 19; x++) {
        expect(s.tiles[y][x]).toBe("d");
        expect(DIRECTIONS.some((d) => neighbor(s, { tx: x, ty: y }, d))).toBe(
          false,
        );
      }
  });
  it("meets all three quantitative proportions", () => {
    const s = initial();
    const degrees = new Map<string, number>();
    s.tiles.forEach((row, ty) =>
      [...row].forEach((char, tx) => {
        if (char === ".")
          degrees.set(
            `${tx},${ty}`,
            DIRECTIONS.filter((d) => neighbor(s, { tx, ty }, d)).length,
          );
      }),
    );
    const openness =
      [...degrees.values()].reduce((a, b) => a + b, 0) / degrees.size;
    const remaining = new Set(
      [...degrees].filter(([, n]) => n === 2).map(([key]) => key),
    );
    const runs: number[] = [];
    while (remaining.size) {
      const queue = [remaining.values().next().value!];
      remaining.delete(queue[0]);
      for (let i = 0; i < queue.length; i++) {
        const [tx, ty] = queue[i].split(",").map(Number);
        for (const d of DIRECTIONS) {
          const n = neighbor(s, { tx, ty }, d);
          const key = n && `${n.tx},${n.ty}`;
          if (key && remaining.delete(key)) queue.push(key);
        }
      }
      runs.push(queue.length);
    }
    const mazing = runs.reduce((a, b) => a + b, 0) / runs.length;
    expect(openness).toBeGreaterThanOrEqual(C.MAZE_OPENNESS_MIN);
    expect(openness).toBeLessThanOrEqual(C.MAZE_OPENNESS_MAX);
    expect(mazing).toBeGreaterThanOrEqual(C.MAZE_MAZING_MIN);
    expect(mazing).toBeLessThanOrEqual(C.MAZE_MAZING_MAX);
    expect(
      degrees.size / ((C.GRID_COLS - 2) * (C.GRID_ROWS - 2)),
    ).toBeGreaterThanOrEqual(C.MAZE_DENSITY_MIN);
    expect(
      degrees.size / ((C.GRID_COLS - 2) * (C.GRID_ROWS - 2)),
    ).toBeLessThanOrEqual(C.MAZE_DENSITY_MAX);
  });
});

describe("engine, actions, and screens", () => {
  it("registers the fixed vocabulary, assets, cues, and pure diagnostics", async () => {
    const h = await harness();
    const snap = h.d.snapshot(h.engine.state);
    expect(snap.screen).toBe("title");
    expect(snap.lives).toBe(C.START_LIVES);
    expect(snap.predators.map((p) => p.kind)).toEqual(C.DEN_ORDER);
    expect(h.engine.state.art["trench-walls"]).toHaveLength(19);
    expect(h.engine.diagnostics().every((d) => d.error === undefined)).toBe(
      true,
    );
    expect(h.d.snapshot(h.engine.state)).toEqual(snap);
    expect(
      h.engine.diagnostics().find((d) => d.name === "windowRadius")?.value,
    ).toBe(C.KINDLE_VISION_MIN);
  });
  it("takes menu key edges, remembers how-to, and holds a fixed countdown", async () => {
    const h = await harness();
    h.key("ArrowUp");
    await h.engine.advance(1);
    expect(h.engine.state.menuIndex).toBe(1);
    await h.engine.advance(2);
    expect(h.engine.state.menuIndex).toBe(1);
    h.key("Enter");
    await h.engine.advance(1);
    expect(h.engine.state.screen).toBe("howto");
    h.key("Enter", false);
    h.key("Escape");
    await h.engine.advance(1);
    expect(h.engine.state.screen).toBe("title");
    expect(h.engine.state.menuIndex).toBe(1);
    expect(h.engine.state.titleIndex).toBe(1);
    h.pose((s) => h.d.setMenuIndex(s, 0));
    h.key("Enter");
    await h.engine.advance(1);
    expect(h.engine.state.screen).toBe("countdown");
    expect(h.engine.state.predators.every((p) => !p.released)).toBe(true);
    await h.engine.advance(214);
    expect(h.engine.state.screen).toBe("countdown");
    await h.engine.advance(1);
    expect(h.engine.state.screen).toBe("playing");
  });
  it("pauses and resumes exactly once with Escape, freezing the world", async () => {
    const h = await harness();
    h.pose(() => fixture());
    h.key("Escape");
    await h.engine.advance(1);
    expect(h.engine.state.screen).toBe("paused");
    const before = h.d.snapshot(h.engine.state);
    await h.engine.advance(120);
    const after = h.d.snapshot(h.engine.state);
    expect({ ...after, simTime: before.simTime }).toEqual(before);
    expect(after.simTime).toBeCloseTo(before.simTime + 1);
    h.key("Escape", false);
    h.key("Escape");
    await h.engine.advance(1);
    expect(h.engine.state.screen).toBe("playing");
  });
  it("requires both pointer edges in one menu region and handles touch", async () => {
    const h = await harness();
    const r0 = h.d.menuItemRect(h.engine.state, 0)!;
    const r1 = h.d.menuItemRect(h.engine.state, 1)!;
    h.pointer("pointerdown", r0.x + 10, r0.y + 10);
    h.pointer("pointerup", r1.x + 10, r1.y + 10);
    await h.engine.advance(1);
    expect(h.engine.state.screen).toBe("title");
    expect(h.engine.state.menuIndex).toBe(1);
    h.pointer("pointerdown", r1.x + 10, r1.y + 10, "touch");
    h.pointer("pointerup", r1.x + 10, r1.y + 10, "touch");
    await h.engine.advance(1);
    expect(h.engine.state.screen).toBe("howto");
    h.pointer("pointerdown", 30, 30);
    h.pointer("pointerup", 1200, 600);
    await h.engine.advance(1);
    expect(h.engine.state.screen).toBe("title");
    expect(h.engine.state.menuIndex).toBe(1);
  });
  it("restarts, quits, and returns from game over with the correct fresh state", async () => {
    const h = await harness();
    for (const source of ["paused", "gameover"] as const) {
      h.pose((s) => h.d.setScreen(h.d.setScore(s, 900), source));
      h.pose((s) => h.d.setMenuIndex(s, source === "paused" ? 1 : 0));
      h.key("Enter");
      await h.engine.advance(1);
      h.key("Enter", false);
      expect(h.engine.state.screen).toBe("countdown");
      expect(h.engine.state.score).toBe(0);
    }
    h.pose((s) => h.d.setScreen(s, "paused"));
    h.pose((s) => h.d.setMenuIndex(s, 2));
    h.key("Enter");
    await h.engine.advance(1);
    expect(h.engine.state.screen).toBe("title");
  });
  it("mirrors engine mute from every screen without suppressing gameplay events", async () => {
    const h = await harness();
    h.key("KeyM");
    await h.engine.advance(1);
    expect(h.engine.state.muted).toBe(true);
    const cues: string[] = [];
    h.engine.events.on("cue:played", (e) => cues.push(e.cue));
    h.pose(() => fixture());
    h.key("Space");
    await h.engine.advance(1);
    expect(cues).toContain(C.CUES.sonar);
    expect(h.engine.state.sonar.cooldown).toBe(C.SONAR_COOLDOWN);
    await h.engine.advance(4);
    expect(cues.filter((c) => c === C.CUES.sonar)).toHaveLength(1);
  });
  it("draws all seven screens from loaded art and records balanced frames", async () => {
    const h = await harness(true);
    h.engine.startRecording();
    for (const value of [
      "title",
      "howto",
      "countdown",
      "playing",
      "paused",
      "cleared",
      "gameover",
    ] as Screen[]) {
      h.pose((s) => h.d.setScreen(s, value));
      await h.engine.advance(1);
    }
    const recording = h.engine.stopRecording();
    expect(recording.frames).toHaveLength(7);
    expect(recording.ops.length).toBeGreaterThan(0);
    expect(
      recording.frames.every((f) => !f.truncated && f.stack.length === 0),
    ).toBe(true);
  });
});

describe("fixed-step travel and fog", () => {
  it("has the same outcome for uniform and uneven frame divisions without mutating the input", () => {
    const start = fixture();
    start.held = ["right"];
    start.desired = "right";
    const saved = debug.snapshot(start);
    let uniform = start;
    let uneven = start;
    for (let i = 0; i < 120; i++) uniform = advance(uniform, C.TICK_DT);
    for (const dt of [0.021, 0.143, 0.006, 0.33, 0.1, 0.4])
      uneven = advance(uneven, dt);
    expect(debug.snapshot(uneven)).toEqual(debug.snapshot(uniform));
    expect(debug.snapshot(start)).toEqual(saved);
    expect(uniform.forager.x - start.forager.x).toBeCloseTo(C.FORAGER_SPEED);
    expect(advance(start, C.TICK_DT / 2).simTime).toBe(0);
  });
  it("moves from engine-held actions and stops immediately on release", async () => {
    const h = await harness();
    h.pose(() => fixture());
    const x = h.engine.state.forager.x;
    h.key("ArrowRight");
    await h.engine.advance(60);
    expect(h.engine.state.forager.x).toBeCloseTo(x + C.FORAGER_SPEED / 2);
    h.key("ArrowRight", false);
    await h.engine.advance(10);
    expect(h.engine.state.forager.x).toBeCloseTo(x + C.FORAGER_SPEED / 2);
    expect(h.engine.state.forager.moving).toBe(false);
  });
  it("buffers corners until a center and reverses between centers", () => {
    let s = fixture();
    s.held = ["right"];
    s.desired = "right";
    s = advance(s, 0.1);
    const oldY = s.forager.y;
    s.desired = "up";
    s = advance(s, 0.1);
    expect(s.forager.y).toBe(oldY);
    s = advance(s, 0.1);
    expect(s.forager.dir).toBe("up");
    expect(s.forager.x).toBeCloseTo(center(7, 8).x);
    const y = s.forager.y;
    s.desired = "down";
    s = advance(s, C.TICK_DT);
    expect(s.forager.y).toBeGreaterThan(y);
  });
  it("crosses the wrap continuously in one ordinary tile step", () => {
    let s = debug.clearPlankton(debug.clearPredators(initial()));
    s = debug.setForagerTile(s, 0, 10);
    s = debug.setScreen(s, "playing");
    s.held = ["left"];
    s.desired = "left";
    s = advance(s, 0.15);
    expect(s.forager.x).toBeCloseTo(
      C.GRID_ORIGIN_X + C.GRID_COLS * C.TILE - 3.2,
    );
    s = advance(s, 0.1);
    expect(s.forager.x).toBeCloseTo(center(C.GRID_COLS - 1, 10).x);
    expect(s.forager.tx).toBe(C.GRID_COLS - 1);
  });
  it("stops at rock and accepts disconnected and den-free fixtures", () => {
    let s = fixture();
    const rows = layer("#");
    put(rows, 6, 8, ".");
    s = debug.setMaze(s, rows);
    s.held = ["right"];
    s.desired = "right";
    s = advance(s, 1);
    expect(s.forager).toMatchObject({ ...center(6, 8), moving: false });
    s = debug.addPredator(s, "gloamfin", 6, 8);
    s = debug.setForagerTile(s, 6, 8);
    s = debug.setPredatorMind(s, 0, false);
    expect(() => advance(s, C.TICK_DT)).not.toThrow();
  });
  it("lights wall endpoints, occludes behind them, and remembers ground beyond the outer window", () => {
    let s = fixture();
    const rows = [...s.tiles];
    put(rows, 8, 8, "#");
    s = debug.setMaze(s, rows);
    expect(lineOfSight(s, s.forager, center(8, 8), true)).toBe(true);
    expect(lineOfSight(s, s.forager, center(9, 8), true)).toBe(false);
    s = advance(s, C.TICK_DT);
    expect(s.visibility[8][8]).toBe("l");
    expect(s.visibility[8][9]).toBe("u");
    s = debug.setForagerTile(s, 26, 8);
    s = advance(s, C.TICK_DT);
    expect(s.visibility[8][6]).toBe("r");
    expect(s.windowRadius).toBe(C.KINDLE_VISION_MIN);
    expect(s.visionRadius).toBe(C.VISION_MIN);
  });
  it("holds brightness for one second then follows the exact half-life curve", () => {
    let s = fixture();
    s = debug.setBrightness(s, 1);
    s = debug.setBrightHold(s, C.BRIGHT_HOLD);
    s = advance(s, C.BRIGHT_HOLD);
    expect(s.brightness).toBeCloseTo(1);
    s = advance(s, C.BRIGHT_HALFLIFE);
    expect(s.brightness).toBeCloseTo(0.5, 9);
    expect(s.windowRadius).toBeCloseTo(
      C.KINDLE_VISION_MIN + C.KINDLE_VISION_GAIN * 0.5,
    );
  });
});

describe("predator senses and effects", () => {
  it("distinguishes light hunting, hearing through rock, and immediate ink blindness", () => {
    let s = fixture();
    s = debug.addPredator(s, "lanternjaw", 9, 8);
    s = debug.setPredatorTravel(s, 0, false);
    s = advance(s, C.TICK_DT);
    expect(s.predators[0]).toMatchObject({
      state: "chase",
      alert: false,
      speed: C.PREDATOR_SPEED,
    });
    s.pendingInk = true;
    s = advance(s, C.TICK_DT);
    expect(s.predators[0].state).toBe("wander");
    expect(s.inkClouds[0].radius).toBe(C.INK_RADIUS);
    s = debug.addPredator(s, "gloamfin", 8, 8);
    s = debug.setPredatorTravel(s, 1, false);
    put(s.tiles, 7, 8, "#");
    s = advance(s, C.TICK_DT);
    expect(s.predators[1]).toMatchObject({
      hearingLock: true,
      state: "chase",
      alert: true,
      speed: C.GLOAMFIN_CHASE_SPEED,
    });
  });
  it("keeps a lapsed light fix for two seconds and does not alert on refresh", () => {
    let s = fixture();
    s = debug.addPredator(s, "flarefish", 9, 8);
    s = debug.setPredatorTravel(s, 0, false);
    s = advance(s, C.TICK_DT);
    expect(s.predators[0].alert).toBe(true);
    s = advance(s, 0.6);
    expect(s.predators[0].alert).toBe(false);
    s = debug.setForagerTile(s, 25, 8);
    s = advance(s, C.LINGER_TIME - C.TICK_DT);
    expect(s.predators[0].state).toBe("chase");
    s = advance(s, C.TICK_DT);
    expect(s.predators[0].state).toBe("wander");
    expect(s.predators[0].flareIn).toBe(C.FLARE_INTERVAL);
  });
  it("floods sonar around corners at front speed, marks only non-amber hunters, and hands a sound fix on arrival", () => {
    let s = fixture();
    s = debug.addPredator(s, "gloamfin", 10, 8);
    s = debug.setPredatorTravel(s, 0, false);
    s = debug.addPredator(s, "lanternjaw", 10, 9);
    s = debug.setPredatorMind(s, 1, false);
    s.pendingSonar = true;
    s = advance(s, 0.2);
    expect(s.predators[0].state).toBe("wander");
    s = advance(s, 0.1);
    expect(s.predators[0]).toMatchObject({
      state: "chase",
      alert: true,
      lit: true,
    });
    expect(s.predators[0].fix).toEqual({ tx: 6, ty: 8 });
    expect(s.predators[1].markLeft).toBe(0);
    expect(s.visibility[8][10]).not.toBe("u");
    s = advance(s, 2);
    expect(s.pulses).toHaveLength(0);
    expect(s.predators[0].markLeft).toBe(0);
  });
  it("sends violet pings that reveal no fog and casts an orange ping during lost-you search", () => {
    let s = fixture();
    s = debug.setForagerTile(s, 25, 8);
    s = debug.addPredator(s, "gloamfin", 6, 8);
    s = debug.setPredatorTravel(s, 0, false);
    s = advance(s, C.GLOAMFIN_PING_INTERVAL);
    expect(s.pulses.some((p) => p.tint === "violet")).toBe(true);
    expect(s.visibility[8][6]).toBe("u");
    s = debug.setForagerTile(s, 6, 8);
    s = debug.setPredatorState(s, 0, "chase");
    s = debug.setForagerTile(s, 25, 8);
    s = advance(s, C.TICK_DT);
    expect(s.predators[0].state).toBe("search");
    s = advance(s, C.GLOAMFIN_PING_MIN_GAP);
    expect(s.predators[0].searchPing).toBe(true);
    s = advance(s, C.GLOAMFIN_GIVEUP);
    expect(s.predators[0].state).toBe("wander");
  });
  it("runs the flare charge, bloom through rock, fade, and full re-arm cadence", () => {
    let s = fixture();
    s = debug.setForagerTile(s, 29, 8);
    s = debug.addPredator(s, "flarefish", 6, 8);
    s = debug.setPredatorTravel(s, 0, false);
    put(s.tiles, 7, 8, "#");
    s = advance(s, C.FLARE_INTERVAL);
    expect(s.predators[0].flareCharging).toBe(true);
    s = advance(s, C.FLARE_CHARGE);
    expect(s.predators[0]).toMatchObject({
      flaring: true,
      flareRadius: C.FLARE_RADIUS,
    });
    expect(s.visibility[8][9]).toBe("l");
    s = advance(s, C.FLARE_BLOOM);
    expect(s.predators[0]).toMatchObject({
      flaring: false,
      flareRadius: 0,
      flareIn: C.FLARE_INTERVAL,
    });
    expect(s.visibility[8][9]).toBe("r");
  });
  it("locks during any bloom tick through rock and ends the bloom immediately", () => {
    let s = fixture();
    s = debug.setForagerTile(s, 29, 8);
    s = debug.addPredator(s, "flarefish", 6, 8);
    s = debug.setPredatorTravel(s, 0, false);
    s = advance(s, C.FLARE_INTERVAL + C.FLARE_CHARGE + 0.1);
    s = debug.setForagerTile(s, 11, 8);
    put(s.tiles, 8, 8, "#");
    s = advance(s, C.TICK_DT);
    expect(s.predators[0]).toMatchObject({
      state: "chase",
      alert: true,
      flaring: false,
      flareRadius: 0,
    });
  });
  it("keeps minds independent from travel and paths a chase around rock", () => {
    let s = fixture();
    s = debug.addPredator(s, "lanternjaw", 11, 8);
    s = debug.setPredatorState(s, 0, "chase");
    put(s.tiles, 9, 8, "#");
    const start = { ...s.predators[0] };
    s = advance(s, 0.8);
    expect(s.tiles[s.predators[0].ty][s.predators[0].tx]).toBe(".");
    expect(s.predators[0].y).not.toBe(start.y);
    s = debug.setPredatorMind(s, 0, false);
    const held = { ...s.predators[0] };
    s = advance(s, 1);
    expect(s.predators[0].x).toBe(held.x);
    expect(s.predators[0].y).toBe(held.y);
  });
  it("drops Gloamfin chase speed at corners and ramps back over two seconds", () => {
    let s = fixture();
    s = debug.addPredator(s, "gloamfin", 8, 8);
    s = debug.setPredatorDir(s, 0, "up");
    s = advance(s, C.TICK_DT);
    expect(s.predators[0].dir).toBe("left");
    expect(s.predators[0].speed).toBe(C.GLOAMFIN_CORNER_SPEED);
    const startX = center(8, 8).x;
    expect(startX - s.predators[0].x).toBeCloseTo(
      C.GLOAMFIN_CORNER_SPEED * C.TICK_DT,
    );
    s = debug.setPredatorTravel(s, 0, false);
    s = advance(s, C.GLOAMFIN_RAMP_TIME / 2);
    expect(s.predators[0].speed).toBeCloseTo(
      (C.GLOAMFIN_CORNER_SPEED + C.GLOAMFIN_CHASE_SPEED) / 2,
    );
    s = advance(s, C.GLOAMFIN_RAMP_TIME / 2);
    expect(s.predators[0].speed).toBeCloseTo(C.GLOAMFIN_CHASE_SPEED);
  });

  it("carries a Gloamfin's own ping to the forager before taking a fixed sound location", () => {
    let s = fixture();
    s = debug.setForagerTile(s, 12, 8);
    s = debug.addPredator(s, "gloamfin", 6, 8);
    s = debug.setPredatorTravel(s, 0, false);
    s = advance(s, C.GLOAMFIN_PING_INTERVAL + 0.3);
    expect(s.predators[0].state).toBe("wander");
    expect(s.visibility[8][6]).toBe("u");
    s = advance(s, 0.15);
    expect(s.predators[0]).toMatchObject({
      state: "chase",
      alert: true,
      hearingLock: false,
    });
    expect(s.predators[0].fix).toEqual({ tx: 12, ty: 8 });
    s = debug.setForagerTile(s, 20, 8);
    s = advance(s, C.TICK_DT);
    expect(s.predators[0].fix).toEqual({ tx: 12, ty: 8 });
  });

  it("releases by scheduled times while travel is frozen", () => {
    let s = debug.setScreen(initial(), "playing");
    s = debug.clearPlankton(s);
    for (let i = 0; i < s.predators.length; i++)
      s = debug.setPredatorTravel(s, i, false);
    s = advance(s, C.TICK_DT);
    expect(s.predators.map((p) => p.released)).toEqual([true, false, false]);
    s = advance(s, C.DEN_RELEASE_GAP - C.TICK_DT);
    expect(s.predators.map((p) => p.released)).toEqual([true, true, false]);
    expect(s.predators.every((p) => p.state === "den")).toBe(true);
  });
});

describe("scoring, progression, and debug poses", () => {
  it("eats on tile entry, awards the clear once, and descends with the run intact", () => {
    let s = fixture();
    s = debug.setPlankton(s, 6, 8, true);
    const cues: string[] = [];
    s = advance(s, C.TICK_DT, (c) => cues.push(c));
    expect(s.score).toBe(C.SCORE_PLANKTON + C.SCORE_CLEAR);
    expect(s.screen).toBe("cleared");
    expect(cues).toEqual([C.CUES.eat, C.CUES.descend]);
    const score = s.score;
    s = advance(s, 2);
    expect(s.screen).toBe("countdown");
    expect(s.depth).toBe(2);
    expect(s.score).toBe(score);
    expect(s.predators).toHaveLength(4);
    expect(s.visibility.every((row) => /^u+$/.test(row))).toBe(true);
  });
  it("costs one reserve life, preserves food and memory, then ends on zero reserves", () => {
    let s = fixture();
    s = debug.setPlankton(s, 8, 8, true);
    s = debug.addPredator(s, "lanternjaw", 6, 8);
    s = debug.setPredatorMind(s, 0, false);
    s = advance(s, C.TICK_DT);
    expect(s.screen).toBe("countdown");
    expect(s.lives).toBe(C.START_LIVES - 1);
    expect(s.planktonRemaining).toBe(1);
    expect(s.visibility[8][6]).not.toBe("u");
    s = debug.setScreen(s, "playing");
    s = debug.setLives(s, 0);
    s = debug.clearPredators(s);
    s = debug.addPredator(s, "flarefish", s.forager.tx, s.forager.ty);
    s = debug.setPredatorMind(s, 0, false);
    s = advance(s, C.TICK_DT);
    expect(s.screen).toBe("gameover");
    expect(s.lives).toBe(0);
  });
  it("admits drifters on cadence, holds their mind/travel, and eats them for the exact bonus", () => {
    let s = debug.clearPredators(debug.setScreen(initial(), "playing"));
    s = debug.setDrifterIn(s, 0);
    s = advance(s, C.TICK_DT);
    expect(s.drifters).toHaveLength(1);
    expect(s.drifterIn).toBe(C.DRIFTER_INTERVAL);
    s = debug.setDrifterMind(s, 0, false);
    const position = { ...s.drifters[0] };
    s = advance(s, 0.5);
    expect(s.drifters[0].x).toBe(position.x);
    s = debug.clearPlankton(s);
    const score = s.score;
    s = debug.setForagerTile(s, position.tx, position.ty);
    s = advance(s, C.TICK_DT);
    expect(s.score).toBe(score + C.SCORE_DRIFTER);
    expect(s.drifters).toHaveLength(0);
  });
  it("caps the roster and sonar range at depth, and allows a posed roster beyond the cap", () => {
    let s = initial();
    for (let depth = 1; depth <= 8; depth++) {
      s = debug.setDepth(s, depth);
      expect(s.predators.length).toBe(3 + Math.min(depth - 1, 3));
      expect(s.sonar.range).toBe(
        Math.max(C.SONAR_RANGE_MIN, C.SONAR_RANGE_BASE - depth + 1),
      );
    }
    s = debug.addPredator(s, "gloamfin", 1, 1);
    expect(s.predators).toHaveLength(7);
  });
  it("reconciles purely, preserves fog/lit/minds, and resets every run value", () => {
    let s = fixture();
    s = debug.setBrightness(s, 1);
    s = debug.clearFog(s);
    s = debug.setScore(s, 123);
    s = debug.setLives(s, 7);
    const before = debug.snapshot(s);
    const reconciled = debug.reconcile(s);
    expect(debug.snapshot(reconciled)).toEqual(before);
    expect(debug.reconcile(reconciled)).toEqual(reconciled);
    expect(reconciled.visibility.every((row) => /^u+$/.test(row))).toBe(true);
    s = debug.reset(s);
    expect(debug.snapshot(s)).toEqual(debug.snapshot(initial()));
  });
  it("rejects invalid domains and indices without altering the original state", () => {
    const s = initial();
    const saved = debug.snapshot(s);
    for (const bad of [
      () => debug.setBrightness(s, 1.1),
      () => debug.setLives(s, -1),
      () => debug.setDepth(s, 0),
      () => debug.setMenuIndex(s, 5),
      () => debug.setMaze(s, ["#"]),
      () => debug.setForagerTile(s, 0, 0),
      () => debug.setPredatorTravel(s, 99, false),
      () => debug.setDrifterMind(s, 0, false),
    ])
      expect(bad).toThrow(RangeError);
    expect(debug.snapshot(s)).toEqual(saved);
    expect(debug.menuItemRect(s, 7)).toBeNull();
  });
  it("uses a scripted uneven clock through the engine", async () => {
    const h = await harness();
    h.engine.setClock(new SequenceClock([3, 7, 11, 19]));
    await h.engine.advance(100);
    expect(h.engine.state.simTime).toBeCloseTo(1);
    expect(h.engine.state.screen).toBe("title");
  });
  it("does not clear a maze when debug removes its last plankton", () => {
    const s = debug.clearPlankton(fixture());
    expect(advance(s, 1).screen).toBe("playing");
    const copy = clone(s);
    copy.forager.x = center(12, 8).x;
    copy.brightness = 0.75;
    copy.sonar.cooldown = 10;
    const next = reconcile(copy);
    expect(next.forager.tx).toBe(12);
    expect(next.sonar.ready).toBe(false);
    expect(next.windowRadius).toBe(
      C.KINDLE_VISION_MIN + C.KINDLE_VISION_GAIN * 0.75,
    );
  });
});
