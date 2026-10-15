import * as C from "./constants";
import type {
  Art,
  Body,
  Direction,
  FathomState,
  Point,
  Predator,
  ReadState,
  Screen,
  TilePoint,
} from "./types";

export const DIRECTIONS: Direction[] = ["up", "down", "left", "right"];
export const VECTOR: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
export const OPPOSITE: Record<Direction, Direction> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};
export const COUNTDOWN_TIME = 1.8;
export const CLEAR_TIME = 2;
export const layer = (char: string): string[] =>
  Array.from({ length: C.GRID_ROWS }, () => char.repeat(C.GRID_COLS));
export const center = (tx: number, ty: number): Point => ({
  x: C.GRID_ORIGIN_X + (tx + 0.5) * C.TILE,
  y: C.GRID_ORIGIN_Y + (ty + 0.5) * C.TILE,
});
export const tileAt = (p: Readonly<Point>): TilePoint => ({
  tx: Math.floor((p.x - C.GRID_ORIGIN_X) / C.TILE),
  ty: Math.floor((p.y - C.GRID_ORIGIN_Y) / C.TILE),
});
export const sameTile = (
  a: Readonly<TilePoint>,
  b: Readonly<TilePoint>,
): boolean => a.tx === b.tx && a.ty === b.ty;
export const distance = (a: Readonly<Point>, b: Readonly<Point>): number =>
  Math.hypot(a.x - b.x, a.y - b.y);
export function put(
  rows: string[],
  tx: number,
  ty: number,
  char: string,
): void {
  rows[ty] = rows[ty].slice(0, tx) + char + rows[ty].slice(tx + 1);
}

/** An intentionally loop-rich, symmetric trench. The central chamber is sealed except at its gate. */
export function makeMaze(): string[] {
  const rows = layer("#");
  for (let y = 1; y < C.GRID_ROWS - 1; y++) {
    for (const x of [1, 5, 9, 13]) {
      put(rows, x, y, ".");
      put(rows, C.GRID_COLS - 1 - x, y, ".");
    }
  }
  for (const y of [1, 4, 7, 10, 13, 16]) {
    for (let x = 1; x <= 13; x++) {
      put(rows, x, y, ".");
      put(rows, C.GRID_COLS - 1 - x, y, ".");
    }
  }
  for (const y of [1, 5, 13, 16])
    for (let x = 13; x <= 22; x++) put(rows, x, y, ".");
  put(rows, 0, 10, ".");
  put(rows, C.GRID_COLS - 1, 10, ".");
  for (let y = 7; y <= 9; y++)
    for (let x = 16; x <= 19; x++) put(rows, x, y, "d");
  put(rows, 17, 6, "g");
  return rows;
}
export function gate(s: ReadState): TilePoint | null {
  for (let ty = 0; ty < C.GRID_ROWS; ty++) {
    const tx = s.tiles[ty].indexOf("g");
    if (tx >= 0) return { tx, ty };
  }
  return null;
}
export const open = (
  s: ReadState,
  tx: number,
  ty: number,
  den = false,
): boolean => {
  const char = s.tiles[ty]?.[tx];
  return char === "." || (den && (char === "d" || char === "g"));
};
export function neighbor(
  s: ReadState,
  p: Readonly<TilePoint>,
  dir: Direction,
  den = false,
): TilePoint | null {
  const v = VECTOR[dir];
  let tx = p.tx + v.x;
  const ty = p.ty + v.y;
  if (tx < 0 || tx >= C.GRID_COLS) {
    const wrap = s.tiles.findIndex(
      (row) => row[0] === "." && row[C.GRID_COLS - 1] === ".",
    );
    if (ty !== wrap) return null;
    tx = (tx + C.GRID_COLS) % C.GRID_COLS;
  }
  return open(s, tx, ty, den) ? { tx, ty } : null;
}
export function flood(
  s: ReadState,
  origin: Readonly<TilePoint>,
  den = false,
): Map<string, number> {
  const result = new Map<string, number>();
  if (!open(s, origin.tx, origin.ty, den)) return result;
  const queue = [{ ...origin }];
  result.set(`${origin.tx},${origin.ty}`, 0);
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    const d = result.get(`${p.tx},${p.ty}`)!;
    for (const dir of DIRECTIONS) {
      const n = neighbor(s, p, dir, den);
      if (!n) continue;
      const key = `${n.tx},${n.ty}`;
      if (!result.has(key)) {
        result.set(key, d + 1);
        queue.push(n);
      }
    }
  }
  return result;
}
export function route(
  s: ReadState,
  body: Readonly<Body>,
  target: Readonly<TilePoint>,
  den = false,
): Direction | null {
  const distances = flood(s, target, den);
  let best = distances.get(`${body.tx},${body.ty}`) ?? Infinity;
  let chosen: Direction | null = null;
  for (const dir of [body.dir, ...DIRECTIONS.filter((d) => d !== body.dir)]) {
    const n = neighbor(s, body, dir, den);
    if (!n) continue;
    const d = distances.get(`${n.tx},${n.ty}`) ?? Infinity;
    if (d < best) {
      best = d;
      chosen = dir;
    }
  }
  return chosen;
}
export function random(s: FathomState): number {
  s.rng = (Math.imul(s.rng, 1664525) + 1013904223) >>> 0;
  return s.rng / 4294967296;
}
export function wander(
  s: FathomState,
  body: Body,
  den = false,
): Direction | null {
  const all = DIRECTIONS.filter((d) => neighbor(s, body, d, den));
  const forward = all.filter((d) => d !== OPPOSITE[body.dir]);
  const choices = forward.length ? forward : all;
  return choices.length
    ? choices[Math.floor(random(s) * choices.length)]
    : null;
}
export function atCenter(b: Readonly<Body>): boolean {
  return distance(b, center(b.tx, b.ty)) < 1e-7;
}

/** Split at centers, not frames. This also carries the overshoot through a wrap boundary. */
export function move(
  s: FathomState,
  body: Body,
  amount: number,
  choose: () => Direction | null,
  den = false,
): boolean {
  if (!open(s, body.tx, body.ty, den)) return false;
  let moved = false;
  while (amount > 1e-9) {
    if (atCenter(body)) {
      const dir = choose();
      if (!dir || !neighbor(s, body, dir, den)) break;
      body.dir = dir;
    }
    const v = VECTOR[body.dir];
    const coordinate = v.x
      ? body.x - C.GRID_ORIGIN_X
      : body.y - C.GRID_ORIGIN_Y;
    const sign = v.x || v.y;
    const nearest =
      Math.round((coordinate - C.TILE / 2) / C.TILE) * C.TILE + C.TILE / 2;
    let toCenter = sign > 0 ? nearest - coordinate : coordinate - nearest;
    if (toCenter <= 1e-7) toCenter += C.TILE;
    const step = Math.min(amount, toCenter);
    body.x += v.x * step;
    body.y += v.y * step;
    const width = C.GRID_COLS * C.TILE;
    if (body.x < C.GRID_ORIGIN_X) body.x += width;
    if (body.x >= C.GRID_ORIGIN_X + width) body.x -= width;
    Object.assign(body, tileAt(body));
    if (step >= toCenter - 1e-8) Object.assign(body, center(body.tx, body.ty));
    amount -= step;
    moved = true;
  }
  return moved;
}

/** Exact grid traversal: a wall endpoint is visible, everything behind it is occluded. */
export function lineOfSight(
  s: ReadState,
  a: Readonly<Point>,
  b: Readonly<Point>,
  wallEndpoint = false,
): boolean {
  const from = tileAt(a);
  const to = tileAt(b);
  let tx = from.tx;
  let ty = from.ty;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const deltaX = dx ? C.TILE / Math.abs(dx) : Infinity;
  const deltaY = dy ? C.TILE / Math.abs(dy) : Infinity;
  let maxX = dx
    ? (C.GRID_ORIGIN_X + (tx + (sx > 0 ? 1 : 0)) * C.TILE - a.x) / dx
    : Infinity;
  let maxY = dy
    ? (C.GRID_ORIGIN_Y + (ty + (sy > 0 ? 1 : 0)) * C.TILE - a.y) / dy
    : Infinity;
  for (let i = 0; i < C.GRID_COLS + C.GRID_ROWS + 2; i++) {
    if (
      s.tiles[ty]?.[tx] === "#" &&
      !(wallEndpoint && tx === to.tx && ty === to.ty)
    )
      return false;
    if (tx === to.tx && ty === to.ty) return true;
    if (Math.abs(maxX - maxY) < 1e-10) {
      if (s.tiles[ty]?.[tx + sx] === "#" || s.tiles[ty + sy]?.[tx] === "#")
        return false;
      tx += sx;
      ty += sy;
      maxX += deltaX;
      maxY += deltaY;
    } else if (maxX < maxY) {
      tx += sx;
      maxX += deltaX;
    } else {
      ty += sy;
      maxY += deltaY;
    }
  }
  return false;
}
export function segmentDistance(
  p: Readonly<Point>,
  a: Readonly<Point>,
  b: Readonly<Point>,
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export const blinded = (s: ReadState, p: Readonly<Point>): boolean =>
  s.inkClouds.some((c) => segmentDistance(c, p, s.forager) <= c.radius);

export function makePredator(
  kind: C.PredatorKind,
  tx: number,
  ty: number,
): Predator {
  return {
    kind,
    ...center(tx, ty),
    tx,
    ty,
    dir: "up",
    state: "wander",
    released: true,
    mind: true,
    travel: true,
    speed: C.PREDATOR_SPEED,
    alert: false,
    lit: false,
    detectRange: null,
    hearingRange: null,
    hearingLock: kind === "gloamfin" ? false : null,
    flareCharging: kind === "flarefish" ? false : null,
    flaring: kind === "flarefish" ? false : null,
    flareRadius: kind === "flarefish" ? 0 : null,
    fix: null,
    linger: 0,
    alertLeft: 0,
    markLeft: 0,
    chaseSpeed: C.GLOAMFIN_CHASE_SPEED,
    pingIn: C.GLOAMFIN_PING_INTERVAL,
    pingGap: C.GLOAMFIN_PING_MIN_GAP,
    searchTime: 0,
    searchPing: false,
    flareIn: C.FLARE_INTERVAL,
    chargeLeft: 0,
    bloomLeft: 0,
    fadeLeft: 0,
    releaseAt: null,
  };
}
export function roster(s: ReadState): Predator[] {
  const kinds = [
    ...C.DEN_ORDER,
    ...C.ROSTER_ADD_ORDER.slice(0, Math.min(s.depth, C.ROSTER_CAP_DEPTH) - 1),
  ];
  const dens: TilePoint[] = [];
  s.tiles.forEach((row, ty) =>
    [...row].forEach((char, tx) => {
      if (char === "d") dens.push({ tx, ty });
    }),
  );
  return kinds.map((kind, index) => {
    const tile = dens[index % dens.length] ?? { tx: 16, ty: 7 };
    return {
      ...makePredator(kind, tile.tx, tile.ty),
      state: "den",
      released: false,
      releaseAt: index * C.DEN_RELEASE_GAP,
    };
  });
}
export function clone(s: ReadState): FathomState {
  return {
    ...s,
    tiles: [...s.tiles],
    plankton: [...s.plankton],
    visibility: [...s.visibility],
    grid: { ...s.grid },
    forager: { ...s.forager },
    sonar: { ...s.sonar },
    ink: { ...s.ink },
    drifters: s.drifters.map((d) => ({ ...d })),
    predators: s.predators.map((p) => ({
      ...p,
      fix: p.fix ? { ...p.fix } : null,
    })),
    pulses: s.pulses.map((p) => ({ ...p })),
    inkClouds: s.inkClouds.map((c) => ({ ...c })),
    held: [...s.held],
    start: { ...s.start },
    pointerDown: { ...s.pointerDown },
    art: s.art as Art,
  };
}
export function reconcile(s: FathomState): FathomState {
  Object.assign(s.forager, tileAt(s.forager));
  s.visionRadius = C.VISION_MIN + C.VISION_GAIN * s.brightness;
  s.windowRadius = C.KINDLE_VISION_MIN + C.KINDLE_VISION_GAIN * s.brightness;
  s.sonar.range = Math.max(
    C.SONAR_RANGE_MIN,
    C.SONAR_RANGE_BASE - (s.depth - 1),
  );
  s.sonar.ready = s.sonar.cooldown === 0;
  s.ink.ready = s.ink.cooldown === 0;
  s.planktonRemaining = s.plankton.reduce(
    (n, row) => n + [...row].filter((c) => c === "*").length,
    0,
  );
  s.drifters.forEach((d) => Object.assign(d, tileAt(d)));
  s.predators.forEach((p) => {
    Object.assign(p, tileAt(p));
    p.detectRange =
      p.kind === "gloamfin"
        ? null
        : C.LANTERN_RANGE_BASE + C.LANTERN_RANGE_GAIN * s.brightness;
    p.hearingRange = p.kind === "gloamfin" ? C.GLOAMFIN_HEAR : null;
    p.speed =
      p.kind === "lanternjaw" && p.state !== "chase"
        ? C.DRIFTER_SPEED
        : p.kind === "gloamfin" && p.state === "chase"
          ? p.chaseSpeed
          : C.PREDATOR_SPEED;
  });
  return s;
}
export function initial(art: Art = {}, muted = false): FathomState {
  const tiles = makeMaze();
  const start = { tx: 17, ty: 13 };
  const s: FathomState = {
    version: C.FATHOM_DEBUG_VERSION,
    screen: "title",
    menuIndex: 0,
    titleIndex: 0,
    depth: 1,
    score: 0,
    lives: C.START_LIVES,
    muted,
    planktonRemaining: 0,
    drifterIn: C.DRIFTER_INTERVAL,
    brightness: 0,
    brightHold: 0,
    visionRadius: C.VISION_MIN,
    windowRadius: C.KINDLE_VISION_MIN,
    sonar: { ready: true, cooldown: 0, range: C.SONAR_RANGE_BASE },
    ink: { ready: true, cooldown: 0 },
    grid: {
      cols: C.GRID_COLS,
      rows: C.GRID_ROWS,
      tile: C.TILE,
      originX: C.GRID_ORIGIN_X,
      originY: C.GRID_ORIGIN_Y,
    },
    tiles,
    plankton: tiles.map((row) =>
      [...row].map((c) => (c === "." ? "*" : "-")).join(""),
    ),
    visibility: layer("u"),
    forager: {
      ...start,
      ...center(start.tx, start.ty),
      dir: "left",
      moving: false,
    },
    drifters: [],
    predators: [],
    pulses: [],
    inkClouds: [],
    simTime: 0,
    accumulator: 0,
    desired: "left",
    held: [],
    pendingSonar: false,
    pendingInk: false,
    screenLeft: COUNTDOWN_TIME,
    playTime: 0,
    rng: 0xf47a0,
    start,
    pointerDown: {},
    art,
  };
  s.predators = roster(s);
  return reconcile(s);
}
export function screen(s: FathomState, value: Screen): void {
  const previous = s.screen;
  s.screen = value;
  s.menuIndex =
    value === "title"
      ? s.titleIndex
      : ["paused", "gameover"].includes(value)
        ? 0
        : null;
  if (value === "countdown") s.screenLeft = COUNTDOWN_TIME;
  if (value === "cleared") s.screenLeft = CLEAR_TIME;
  if (value === "playing" && previous !== "paused") s.playTime = 0;
  s.pointerDown = {};
}
export function newDive(
  s: FathomState,
  to: "title" | "countdown",
): FathomState {
  const next = initial(s.art, s.muted);
  next.titleIndex = s.titleIndex;
  next.simTime = s.simTime;
  next.accumulator = s.accumulator;
  screen(next, to);
  return next;
}
