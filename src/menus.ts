import * as C from "./constants";
import type { UpdateApi } from "@clockwyrks/simple-2d";
import type { FathomState, ReadState, Rect } from "./types";
import { clone, DIRECTIONS, newDive, screen } from "./world";

export function menuItems(s: ReadState): readonly string[] {
  return s.screen === "title"
    ? C.TITLE_ITEMS
    : s.screen === "paused"
      ? C.PAUSE_ITEMS
      : s.screen === "gameover"
        ? C.GAMEOVER_ITEMS
        : [];
}
export function menuItemRect(s: ReadState, index: number): Rect | null {
  if (!Number.isInteger(index) || index < 0 || index >= menuItems(s).length)
    return null;
  return {
    x: 460,
    y: (s.screen === "title" ? 435 : 350) + index * 62,
    w: 360,
    h: 50,
  };
}
function hit(s: ReadState, x: number, y: number): number {
  return menuItems(s).findIndex((_, i) => {
    const r = menuItemRect(s, i)!;
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  });
}
function confirm(s: FathomState): FathomState {
  if (s.screen === "title") {
    s.titleIndex = s.menuIndex!;
    if (s.menuIndex === 0) return newDive(s, "countdown");
    screen(s, "howto");
  } else if (s.screen === "paused") {
    if (s.menuIndex === 0) screen(s, "playing");
    else return newDive(s, s.menuIndex === 1 ? "countdown" : "title");
  } else if (s.screen === "gameover")
    return newDive(s, s.menuIndex === 0 ? "countdown" : "title");
  return s;
}
export function input(state: ReadState, api: UpdateApi): FathomState {
  let s = clone(state);
  if (api.input.pressed("mute")) api.audio.setMuted(!api.audio.muted());
  s.muted = api.audio.muted();
  if (s.screen === "playing") {
    if (api.input.pressed("pause")) {
      screen(s, "paused");
      return s;
    }
    const held = DIRECTIONS.filter((d) => api.input.value(d) > 0);
    const newest = held.filter((d) => !s.held.includes(d));
    if (newest.length) s.desired = newest[newest.length - 1];
    s.held = held;
    s.pendingSonar ||= api.input.pressed("a");
    s.pendingInk ||= api.input.pressed("b");
    return s;
  }
  if (s.screen === "paused") {
    const pause = api.input.pressed("pause");
    const back = api.input.pressed("back");
    if (pause || back) {
      screen(s, "playing");
      return s;
    }
  }
  if (s.screen === "howto") {
    if (api.input.pressed("confirm") || api.input.pressed("back"))
      return newDive(s, "title");
  } else if (s.screen === "gameover" && api.input.pressed("back"))
    return newDive(s, "title");
  const items = menuItems(s);
  if (items.length) {
    if (api.input.pressed("up"))
      s.menuIndex = (s.menuIndex! + items.length - 1) % items.length;
    if (api.input.pressed("down"))
      s.menuIndex = (s.menuIndex! + 1) % items.length;
    if (api.input.pressed("confirm")) return confirm(s);
  }
  for (const sample of api.input.pointerSamples()) {
    if (s.screen !== "howto" && !menuItems(s).length) break;
    const index = hit(s, sample.x, sample.y);
    if (index >= 0) s.menuIndex = index;
    if (sample.type === "down")
      s.pointerDown[sample.id] = s.screen === "howto" ? -2 : index;
    if (sample.type === "up") {
      const pressed = s.pointerDown[sample.id];
      delete s.pointerDown[sample.id];
      if (s.screen === "howto" && pressed === -2) return newDive(s, "title");
      if (index >= 0 && pressed === index) {
        s.menuIndex = index;
        s = confirm(s);
        break;
      }
    }
  }
  return s;
}
