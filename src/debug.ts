import * as C from "./constants";
import type {
  Body,
  Direction,
  FathomDebugApi,
  FathomState,
  Predator,
  ReadState,
  Screen,
  Snapshot,
} from "./types";
import {
  center,
  clone,
  DIRECTIONS,
  initial,
  layer,
  makePredator,
  put,
  reconcile,
  roster,
  screen,
} from "./world";
import { menuItemRect, menuItems } from "./menus";
import { clearLayer } from "./simulation";

function valid(condition: boolean, message: string): asserts condition {
  if (!condition) throw new RangeError(`Fathom: ${message}`);
}
function number(n: number, min = 0, max = Infinity, integer = false): void {
  valid(
    Number.isFinite(n) &&
      n >= min &&
      n <= max &&
      (!integer || Number.isInteger(n)),
    `invalid number ${n}`,
  );
}
function bool(b: boolean): void {
  valid(typeof b === "boolean", "expected a boolean");
}
function tile(s: ReadState, tx: number, ty: number, den = false): void {
  number(tx, 0, C.GRID_COLS - 1, true);
  number(ty, 0, C.GRID_ROWS - 1, true);
  valid(
    (den ? ".dg" : ".").includes(s.tiles[ty][tx]),
    "tile is closed to this body",
  );
}
function direction(dir: Direction): void {
  valid(DIRECTIONS.includes(dir), "invalid direction");
}
function pose(s: ReadState, change: (next: FathomState) => void): FathomState {
  const next = clone(s);
  change(next);
  return reconcile(next);
}
function predator(
  s: ReadState,
  index: number,
  change: (p: Predator, s: FathomState) => void,
): FathomState {
  number(index, 0, s.predators.length - 1, true);
  return pose(s, (next) => change(next.predators[index], next));
}
function drifter(
  s: ReadState,
  index: number,
  change: (d: FathomState["drifters"][number]) => void,
): FathomState {
  number(index, 0, s.drifters.length - 1, true);
  return pose(s, (next) => change(next.drifters[index]));
}
function place(b: Body, tx: number, ty: number): void {
  Object.assign(b, center(tx, ty), { tx, ty });
}

export function snapshot(state: ReadState): Snapshot {
  const s = reconcile(clone(state));
  return {
    version: s.version,
    screen: s.screen,
    menuIndex: s.menuIndex,
    titleIndex: s.titleIndex,
    depth: s.depth,
    score: s.score,
    lives: s.lives,
    muted: s.muted,
    planktonRemaining: s.planktonRemaining,
    drifterIn: s.drifterIn,
    brightness: s.brightness,
    brightHold: s.brightHold,
    visionRadius: s.visionRadius,
    windowRadius: s.windowRadius,
    sonar: s.sonar,
    ink: s.ink,
    grid: s.grid,
    tiles: s.tiles,
    plankton: s.plankton,
    visibility: s.visibility,
    forager: s.forager,
    drifters: s.drifters.map((d) => ({
      x: d.x,
      y: d.y,
      tx: d.tx,
      ty: d.ty,
      lit: d.lit,
      mind: d.mind,
      travel: d.travel,
    })),
    predators: s.predators.map((p) => ({
      kind: p.kind,
      x: p.x,
      y: p.y,
      tx: p.tx,
      ty: p.ty,
      dir: p.dir,
      state: p.state,
      released: p.released,
      mind: p.mind,
      travel: p.travel,
      speed: p.speed,
      alert: p.alert,
      lit: p.lit,
      detectRange: p.detectRange,
      hearingRange: p.hearingRange,
      hearingLock: p.hearingLock,
      flareCharging: p.flareCharging,
      flaring: p.flaring,
      flareRadius: p.flareRadius,
    })),
    pulses: s.pulses.map((p) => ({
      source: p.source,
      tint: p.tint,
      ox: p.ox,
      oy: p.oy,
      front: Math.max(0, p.front),
      range: p.range,
    })),
    inkClouds: s.inkClouds,
    simTime: s.simTime,
  };
}

const screens: Screen[] = [
  "title",
  "howto",
  "countdown",
  "playing",
  "paused",
  "cleared",
  "gameover",
];
export const debug: FathomDebugApi = {
  version: C.FATHOM_DEBUG_VERSION,
  reset: (s) => initial(s.art as FathomState["art"], s.muted),
  snapshot,
  reconcile: (s) => reconcile(clone(s)),
  setScreen: (s, value) => {
    valid(screens.includes(value), "invalid screen");
    return pose(s, (n) => screen(n, value));
  },
  setMenuIndex: (s, index) => {
    number(index, 0, menuItems(s).length - 1, true);
    return pose(s, (n) => {
      n.menuIndex = index;
    });
  },
  setTitleIndex: (s, index) => {
    number(index, 0, C.TITLE_ITEMS.length - 1, true);
    return pose(s, (n) => {
      n.titleIndex = index;
    });
  },
  menuItemRect,
  setScore: (s, points) => {
    number(points, 0, Infinity, true);
    return pose(s, (n) => {
      n.score = points;
    });
  },
  setLives: (s, lives) => {
    number(lives, 0, Infinity, true);
    return pose(s, (n) => {
      n.lives = lives;
    });
  },
  setDepth: (s, depth) => {
    number(depth, 1, Infinity, true);
    return pose(s, (n) => {
      n.depth = depth;
      n.predators = roster(n);
    });
  },
  setMaze: (s, rows) => {
    valid(
      Array.isArray(rows) &&
        rows.length === C.GRID_ROWS &&
        rows.every(
          (row) =>
            typeof row === "string" &&
            row.length === C.GRID_COLS &&
            /^[#.gd]+$/.test(row),
        ),
      "invalid maze layout",
    );
    const gates = rows.join("").split("g").length - 1;
    valid(
      !rows.some((row) => /[gd]/.test(row)) || gates === 1,
      "a den requires exactly one gate",
    );
    return pose(s, (n) => {
      n.tiles = [...rows];
    });
  },
  setPlankton: (s, tx, ty, present) => {
    tile(s, tx, ty);
    bool(present);
    return pose(s, (n) => put(n.plankton, tx, ty, present ? "*" : "-"));
  },
  clearPlankton: (s) => pose(s, clearLayer),
  clearFog: (s) =>
    pose(s, (n) => {
      n.visibility = layer("u");
    }),
  setForagerTile: (s, tx, ty) => {
    tile(s, tx, ty);
    return pose(s, (n) => {
      place(n.forager, tx, ty);
      n.forager.moving = false;
      n.held = [];
      n.desired = n.forager.dir;
    });
  },
  setForagerDir: (s, dir) => {
    direction(dir);
    return pose(s, (n) => {
      n.forager.dir = dir;
      n.forager.moving = false;
      n.held = [];
      n.desired = dir;
    });
  },
  setBrightness: (s, g) => {
    number(g, 0, 1);
    return pose(s, (n) => {
      n.brightness = g;
    });
  },
  setBrightHold: (s, seconds) => {
    number(seconds, 0, C.BRIGHT_HOLD);
    return pose(s, (n) => {
      n.brightHold = seconds;
    });
  },
  clearPredators: (s) =>
    pose(s, (n) => {
      n.predators = [];
    }),
  addPredator: (s, kind, tx, ty) => {
    valid(C.DEN_ORDER.includes(kind), "invalid predator kind");
    tile(s, tx, ty);
    return pose(s, (n) => {
      n.predators.push(makePredator(kind, tx, ty));
    });
  },
  setPredatorTile: (s, index, tx, ty) => {
    tile(s, tx, ty, true);
    return predator(s, index, (p) => place(p, tx, ty));
  },
  setPredatorDir: (s, index, dir) => {
    direction(dir);
    return predator(s, index, (p) => {
      p.dir = dir;
    });
  },
  setPredatorState: (s, index, value) => {
    valid(["den", "wander", "chase"].includes(value), "invalid predator state");
    return predator(s, index, (p, n) => {
      const char = n.tiles[p.ty]?.[p.tx];
      valid(
        value === "den" ? char === "d" || char === "g" : char === ".",
        "predator state is incompatible with its tile",
      );
      p.state = value;
      p.fix = null;
      p.alert = false;
      p.alertLeft = 0;
      p.hearingLock = p.kind === "gloamfin" ? false : null;
      p.chargeLeft = 0;
      p.bloomLeft = 0;
      p.flareIn = C.FLARE_INTERVAL;
      if (p.kind === "flarefish") {
        p.flareCharging = false;
        p.flaring = false;
        p.flareRadius = 0;
      }
      if (value === "chase") {
        p.fix = { tx: n.forager.tx, ty: n.forager.ty };
        p.linger = C.LINGER_TIME;
        p.chaseSpeed = C.GLOAMFIN_CHASE_SPEED;
      }
    });
  },
  setPredatorReleased: (s, index, released) => {
    bool(released);
    return predator(s, index, (p) => {
      p.released = released;
    });
  },
  setPredatorMind: (s, index, enabled) => {
    bool(enabled);
    return predator(s, index, (p) => {
      p.mind = enabled;
    });
  },
  setPredatorTravel: (s, index, enabled) => {
    bool(enabled);
    return predator(s, index, (p) => {
      p.travel = enabled;
    });
  },
  spawnDrifter: (s, tx, ty) => {
    tile(s, tx, ty);
    return pose(s, (n) => {
      n.drifters.push({
        ...center(tx, ty),
        tx,
        ty,
        dir: "up",
        lit: false,
        mind: true,
        travel: true,
      });
    });
  },
  clearDrifters: (s) =>
    pose(s, (n) => {
      n.drifters = [];
    }),
  setDrifterMind: (s, index, enabled) => {
    bool(enabled);
    return drifter(s, index, (d) => {
      d.mind = enabled;
    });
  },
  setDrifterTravel: (s, index, enabled) => {
    bool(enabled);
    return drifter(s, index, (d) => {
      d.travel = enabled;
    });
  },
  setDrifterIn: (s, seconds) => {
    number(seconds, 0, C.DRIFTER_INTERVAL);
    return pose(s, (n) => {
      n.drifterIn = seconds;
    });
  },
  setSonarCooldown: (s, seconds) => {
    number(seconds);
    return pose(s, (n) => {
      n.sonar.cooldown = seconds;
    });
  },
  setInkCooldown: (s, seconds) => {
    number(seconds);
    return pose(s, (n) => {
      n.ink.cooldown = seconds;
    });
  },
};
