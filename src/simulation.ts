import * as C from "./constants";
import type {
  Direction,
  FathomState,
  Predator,
  Pulse,
  ReadState,
} from "./types";
import {
  atCenter,
  blinded,
  center,
  clone,
  DIRECTIONS,
  distance,
  flood,
  gate,
  initial,
  layer,
  lineOfSight,
  move,
  neighbor,
  OPPOSITE,
  put,
  reconcile,
  roster,
  route,
  sameTile,
  screen,
  wander,
} from "./world";

const down = (n: number): number =>
  Math.max(0, n - C.TICK_DT < 1e-9 ? 0 : n - C.TICK_DT);
export type CueSink = (cue: C.CueName) => void;

export function acquire(s: FathomState, p: Predator, fresh = false): void {
  if (p.state !== "chase" || fresh) {
    if (p.kind !== "lanternjaw") {
      p.alertLeft = C.ALERT_TIME;
      p.alert = true;
    }
    p.chaseSpeed = C.GLOAMFIN_CHASE_SPEED;
  }
  p.fix = { tx: s.forager.tx, ty: s.forager.ty };
  p.state = "chase";
  p.linger = C.LINGER_TIME;
  if (p.kind === "flarefish") {
    if (p.bloomLeft > 0) p.fadeLeft = 0.4;
    p.chargeLeft = 0;
    p.bloomLeft = 0;
    p.flareCharging = false;
    p.flaring = false;
    p.flareRadius = 0;
  }
  // Reversal is immediate, while a corner still waits for its center.
  const dir = route(s, p, p.fix);
  if (dir === OPPOSITE[p.dir]) p.dir = dir;
}
function drop(p: Predator): void {
  p.state = "wander";
  p.fix = null;
  p.linger = 0;
  if (p.kind === "flarefish") {
    p.flareIn = C.FLARE_INTERVAL;
    p.chargeLeft = 0;
    p.bloomLeft = 0;
    p.flareCharging = false;
    p.flaring = false;
    p.flareRadius = 0;
  }
}
function castPing(
  s: FathomState,
  p: Predator,
  index: number,
  orange: boolean,
  cue: CueSink,
): void {
  s.pulses.push({
    source: "gloamfin",
    tint: orange ? "orange" : "violet",
    ox: p.tx,
    oy: p.ty,
    front: -1e-6,
    range: C.GLOAMFIN_PING_RANGE,
    owner: index,
    caught: false,
  });
  p.pingIn = C.GLOAMFIN_PING_INTERVAL;
  p.pingGap = 0;
  if (orange) p.searchPing = true;
  cue(C.CUES.predatorPing);
}
function mind(s: FathomState, p: Predator, index: number, cue: CueSink): void {
  p.alertLeft = down(p.alertLeft);
  p.alert = p.alertLeft > 0;
  p.markLeft = down(p.markLeft);
  p.fadeLeft = down(p.fadeLeft);
  if (p.releaseAt !== null && s.playTime + C.TICK_DT + 1e-8 >= p.releaseAt)
    p.released = true;
  if (!p.mind) return;
  if (p.state === "den") return;
  if (p.kind === "gloamfin") {
    const hadLock = p.hearingLock;
    p.hearingLock = distance(p, s.forager) <= C.GLOAMFIN_HEAR;
    p.pingGap += C.TICK_DT;
    p.pingIn = down(p.pingIn);
    if (p.hearingLock) acquire(s, p);
    else if (hadLock) p.pingIn = 0;
    if (
      p.state === "chase" &&
      p.fix &&
      sameTile(p, p.fix) &&
      !sameTile(p, s.forager)
    ) {
      p.state = "search";
      p.searchTime = 0;
      p.searchPing = false;
    }
    if (p.state === "search") {
      p.searchTime += C.TICK_DT;
      if (p.searchTime + 1e-8 >= C.GLOAMFIN_GIVEUP) drop(p);
    }
    const orange =
      p.state === "search" &&
      !p.searchPing &&
      p.searchTime + 1e-8 >= C.GLOAMFIN_SEARCH_DELAY;
    if (
      !p.hearingLock &&
      p.pingGap + 1e-8 >= C.GLOAMFIN_PING_MIN_GAP &&
      (orange || p.pingIn === 0)
    )
      castPing(s, p, index, orange, cue);
    if (p.state === "chase")
      p.chaseSpeed = Math.min(
        C.GLOAMFIN_CHASE_SPEED,
        p.chaseSpeed +
          ((C.GLOAMFIN_CHASE_SPEED - C.GLOAMFIN_CORNER_SPEED) * C.TICK_DT) /
            C.GLOAMFIN_RAMP_TIME,
      );
    return;
  }
  const blind = blinded(s, p);
  if (blind && p.state === "chase") {
    drop(p);
    return;
  }
  const sensed =
    !blind &&
    distance(p, s.forager) <=
      C.LANTERN_RANGE_BASE + C.LANTERN_RANGE_GAIN * s.brightness &&
    lineOfSight(s, p, s.forager);
  if (sensed) {
    acquire(s, p);
    return;
  }
  if (p.state === "chase") {
    p.linger = down(p.linger);
    if (p.linger === 0) drop(p);
    return;
  }
  if (p.kind !== "flarefish") return;
  if (p.chargeLeft > 0) {
    p.chargeLeft = down(p.chargeLeft);
    if (p.chargeLeft === 0) {
      p.bloomLeft = C.FLARE_BLOOM;
      cue(C.CUES.flare);
    }
  } else if (p.bloomLeft > 0) {
    p.bloomLeft = down(p.bloomLeft);
    if (p.bloomLeft === 0) {
      p.flareIn = C.FLARE_INTERVAL;
      p.fadeLeft = 0.4;
    }
  } else {
    p.flareIn = down(p.flareIn);
    if (p.flareIn === 0) p.chargeLeft = C.FLARE_CHARGE;
  }
  p.flareCharging = p.chargeLeft > 0;
  p.flaring = p.bloomLeft > 0;
  p.flareRadius = p.flaring ? C.FLARE_RADIUS : 0;
  if (p.flaring && !blind && distance(p, s.forager) <= C.FLARE_RADIUS)
    acquire(s, p);
}

function swimPredator(s: FathomState, p: Predator): void {
  if (!p.mind || !p.travel) return;
  if (p.state === "den") {
    const door = gate(s);
    if (!door || !s.tiles.some((row) => row.includes("d")) || !p.released)
      return;
    const outside = DIRECTIONS.map((d) => neighbor(s, door, d)).find(
      (n) => n !== null,
    );
    if (!outside) return;
    move(s, p, p.speed * C.TICK_DT, () => route(s, p, outside, true), true);
    if (s.tiles[p.ty]?.[p.tx] === ".") p.state = "wander";
    return;
  }
  const decide = (): Direction | null => {
    let chosen: Direction | null;
    if (p.state === "chase" && p.fix) chosen = route(s, p, p.fix);
    else if (p.state === "search" && p.fix) {
      const distances = flood(s, p.fix);
      const current = distances.get(`${p.tx},${p.ty}`) ?? Infinity;
      if (current >= C.GLOAMFIN_SEARCH_ROAM) chosen = route(s, p, p.fix);
      else {
        const candidates = DIRECTIONS.filter((d) => {
          const n = neighbor(s, p, d);
          return (
            n &&
            (distances.get(`${n.tx},${n.ty}`) ?? Infinity) <=
              C.GLOAMFIN_SEARCH_ROAM
          );
        });
        chosen = candidates.includes(p.dir) ? p.dir : (candidates[0] ?? null);
      }
    } else chosen = wander(s, p);
    if (
      chosen &&
      p.kind === "gloamfin" &&
      p.state === "chase" &&
      chosen !== p.dir &&
      chosen !== OPPOSITE[p.dir]
    ) {
      p.chaseSpeed = C.GLOAMFIN_CORNER_SPEED;
      p.speed = p.chaseSpeed;
    }
    return chosen;
  };
  // A corner changes the rate on this tick, before integrating its distance.
  if (atCenter(p)) {
    const first = decide();
    if (!first) return;
    let initialChoice = true;
    move(s, p, p.speed * C.TICK_DT, () => {
      if (initialChoice) {
        initialChoice = false;
        return first;
      }
      return decide();
    });
  } else move(s, p, p.speed * C.TICK_DT, decide);
}

export function pulseDistances(
  s: ReadState,
  pulse: Readonly<Pulse>,
): Map<string, number> {
  return flood(s, { tx: pulse.ox, ty: pulse.oy }, true);
}
function advancePulses(s: FathomState): void {
  for (const pulse of s.pulses) {
    const previous = pulse.front;
    pulse.front += C.SONAR_WAVE_SPEED * C.TICK_DT;
    const distances = pulseDistances(s, pulse);
    const reached = (tx: number, ty: number): boolean => {
      const d = distances.get(`${tx},${ty}`);
      return (
        d !== undefined && d > previous && d <= pulse.front && d <= pulse.range
      );
    };
    if (pulse.source === "forager") {
      for (const p of s.predators) {
        if (p.state === "den" || !reached(p.tx, p.ty)) continue;
        if (p.kind !== "lanternjaw") p.markLeft = C.SONAR_MARK_TIME;
        if (p.kind === "gloamfin" && p.mind) acquire(s, p, true);
      }
    } else if (!pulse.caught && reached(s.forager.tx, s.forager.ty)) {
      const owner = pulse.owner === null ? undefined : s.predators[pulse.owner];
      if (owner?.mind && owner.state !== "den") acquire(s, owner, true);
      pulse.caught = true;
    }
    if (pulse.source === "forager") {
      for (const [key, d] of distances) {
        if (d > pulse.range || d <= previous || d > pulse.front) continue;
        const [tx, ty] = key.split(",").map(Number);
        put(s.visibility, tx, ty, "l");
        for (const dir of DIRECTIONS) {
          const v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[
            dir
          ];
          const x = tx + v[0];
          const y = ty + v[1];
          if (s.tiles[y]?.[x] === "#") put(s.visibility, x, y, "l");
        }
      }
    }
  }
  s.pulses = s.pulses.filter((p) => p.front <= p.range);
}

export function illuminate(s: FathomState, keepCurrent = false): void {
  if (!keepCurrent)
    s.visibility = s.visibility.map((row) => row.replace(/l/g, "r"));
  const flares = s.predators.filter((p) => p.flaring && p.state !== "den");
  for (let ty = 0; ty < C.GRID_ROWS; ty++)
    for (let tx = 0; tx < C.GRID_COLS; tx++) {
      const p = center(tx, ty);
      if (
        (distance(p, s.forager) <= s.visionRadius &&
          lineOfSight(s, s.forager, p, true)) ||
        flares.some((f) => distance(f, p) <= C.FLARE_RADIUS)
      )
        put(s.visibility, tx, ty, "l");
    }
  const lit = (
    p: Readonly<Predator> | Readonly<FathomState["drifters"][number]>,
  ): boolean =>
    (distance(center(p.tx, p.ty), s.forager) <= s.visionRadius &&
      lineOfSight(s, s.forager, center(p.tx, p.ty), true)) ||
    flares.some((f) => distance(f, p) <= C.FLARE_RADIUS);
  s.predators.forEach((p) => {
    p.lit =
      p.state !== "den" &&
      (lit(p) ||
        p.alert ||
        p.flareCharging === true ||
        (p.kind !== "lanternjaw" && p.markLeft > 0));
  });
  s.drifters.forEach((d) => {
    d.lit = lit(d);
  });
}
function respawn(s: FathomState): void {
  Object.assign(s.forager, center(s.start.tx, s.start.ty), s.start, {
    dir: "left",
    moving: false,
  });
  s.desired = "left";
  s.brightness = 0;
  s.brightHold = 0;
  s.predators = roster(s);
  s.drifters = [];
  s.drifterIn = C.DRIFTER_INTERVAL;
  s.pulses = [];
  s.inkClouds = [];
  s.sonar.cooldown = 0;
  s.ink.cooldown = 0;
  s.pendingInk = false;
  s.pendingSonar = false;
  screen(s, "countdown");
  reconcile(s);
}
function descend(s: FathomState): FathomState {
  const next = initial(s.art, s.muted);
  next.depth = s.depth + 1;
  next.score = s.score;
  next.lives = s.lives;
  next.titleIndex = s.titleIndex;
  next.simTime = s.simTime;
  next.accumulator = s.accumulator;
  next.predators = roster(next);
  screen(next, "countdown");
  return reconcile(next);
}
export function tick(s: FathomState, cue: CueSink): FathomState {
  s.simTime += C.TICK_DT;
  if (s.screen === "countdown") {
    illuminate(s);
    s.screenLeft = down(s.screenLeft);
    if (s.screenLeft === 0) {
      screen(s, "playing");
      s.predators.forEach((p) => {
        if (p.releaseAt === 0 && p.mind) p.released = true;
      });
    }
    return s;
  }
  if (s.screen === "cleared") {
    s.screenLeft = down(s.screenLeft);
    return s.screenLeft === 0 ? descend(s) : s;
  }
  if (s.screen !== "playing") return s;
  s.visibility = s.visibility.map((row) => row.replace(/l/g, "r"));
  s.sonar.cooldown = down(s.sonar.cooldown);
  s.ink.cooldown = down(s.ink.cooldown);
  const decayTime = Math.max(0, C.TICK_DT - s.brightHold);
  s.brightHold = down(s.brightHold);
  if (decayTime) s.brightness *= 0.5 ** (decayTime / C.BRIGHT_HALFLIFE);
  s.inkClouds.forEach((c) => {
    c.remaining = down(c.remaining);
  });
  s.inkClouds = s.inkClouds.filter((c) => c.remaining > 0);
  if (s.pendingSonar && s.sonar.cooldown === 0) {
    s.pulses.push({
      source: "forager",
      tint: "cyan",
      ox: s.forager.tx,
      oy: s.forager.ty,
      front: -1e-6,
      range: s.sonar.range,
      owner: null,
      caught: false,
    });
    s.sonar.cooldown = C.SONAR_COOLDOWN;
    cue(C.CUES.sonar);
  }
  if (s.pendingInk && s.ink.cooldown === 0) {
    s.inkClouds.push({
      x: s.forager.x,
      y: s.forager.y,
      radius: C.INK_RADIUS,
      remaining: C.INK_LIFE,
    });
    s.ink.cooldown = C.INK_COOLDOWN;
    cue(C.CUES.ink);
  }
  s.pendingSonar = false;
  s.pendingInk = false;
  if (s.held.length) {
    if (s.desired === OPPOSITE[s.forager.dir]) s.forager.dir = s.desired;
    s.forager.moving = move(s, s.forager, C.FORAGER_SPEED * C.TICK_DT, () =>
      neighbor(s, s.forager, s.desired)
        ? s.desired
        : neighbor(s, s.forager, s.forager.dir)
          ? s.forager.dir
          : null,
    );
  } else s.forager.moving = false;
  if (
    s.plankton[s.forager.ty]?.[s.forager.tx] === "*" &&
    s.tiles[s.forager.ty]?.[s.forager.tx] === "."
  ) {
    put(s.plankton, s.forager.tx, s.forager.ty, "-");
    s.planktonRemaining--;
    s.score += C.SCORE_PLANKTON;
    s.brightness = Math.min(1, s.brightness + C.BRIGHT_PER_EAT);
    s.brightHold = C.BRIGHT_HOLD;
    cue(C.CUES.eat);
    if (s.planktonRemaining === 0) {
      s.score += C.SCORE_CLEAR;
      screen(s, "cleared");
      cue(C.CUES.descend);
      reconcile(s);
      illuminate(s);
      return s;
    }
  }
  reconcile(s);
  s.predators.forEach((p, i) => mind(s, p, i, cue));
  reconcile(s);
  s.predators.forEach((p) => swimPredator(s, p));
  s.drifters.forEach((d) => {
    if (d.mind && d.travel)
      move(s, d, C.DRIFTER_SPEED * C.TICK_DT, () => wander(s, d));
  });
  s.drifters = s.drifters.filter((d) => {
    if (!sameTile(d, s.forager)) return true;
    s.score += C.SCORE_DRIFTER;
    return false;
  });
  if (s.planktonRemaining > 0) {
    s.drifterIn = down(s.drifterIn);
    if (s.drifterIn === 0 && s.drifters.length < C.DRIFTER_MAX) {
      const door = gate(s);
      const entry =
        door &&
        DIRECTIONS.map((d) => neighbor(s, door, d)).find((n) => n !== null);
      if (entry) {
        s.drifters.push({
          ...entry,
          ...center(entry.tx, entry.ty),
          dir: "up",
          lit: false,
          mind: true,
          travel: true,
        });
        s.drifterIn = C.DRIFTER_INTERVAL;
      }
    }
  }
  advancePulses(s);
  reconcile(s);
  illuminate(s, true);
  if (s.predators.some((p) => p.state !== "den" && sameTile(p, s.forager))) {
    cue(C.CUES.caught);
    if (s.lives === 0) screen(s, "gameover");
    else {
      s.lives--;
      respawn(s);
      illuminate(s);
    }
  }
  s.playTime += C.TICK_DT;
  return reconcile(s);
}

/** Render-free, deterministic stepping; callers supply input in the state and receive a new value. */
export function advance(
  state: ReadState,
  dt: number,
  play: CueSink = () => {},
): FathomState {
  let s = clone(state);
  s.accumulator += dt;
  const ticks = Math.floor((s.accumulator + 1e-10) / C.TICK_DT);
  s.accumulator = Math.max(0, s.accumulator - ticks * C.TICK_DT);
  for (let i = 0; i < ticks; i++) {
    const cues = new Set<C.CueName>();
    s = tick(s, (cue) => cues.add(cue));
    cues.forEach(play);
  }
  return s;
}
export function clearLayer(s: FathomState): void {
  s.plankton = layer("-");
  s.planktonRemaining = 0;
}
