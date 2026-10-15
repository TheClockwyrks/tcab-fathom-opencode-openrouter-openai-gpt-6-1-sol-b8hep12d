import * as C from "./constants";
import type { Direction, Point, ReadState } from "./types";
import { center, distance } from "./world";
import { menuItemRect, menuItems } from "./menus";
import { pulseDistances } from "./simulation";

const P = {
  bg: "#02090e",
  ink: "#010407",
  text: "#d8f7f3",
  dim: "#658d96",
  faint: "#294852",
  cyan: "#6af5df",
  blue: "#39b9ce",
  amber: "#ff9968",
  violet: "#b69bff",
  orange: "#ffb26b",
  line: "#173039",
};
const FONT = '"SFMono-Regular", Consolas, "Liberation Mono", monospace';
type Context = CanvasRenderingContext2D;

function text(
  ctx: Context,
  value: string,
  x: number,
  y: number,
  size = 14,
  color = P.text,
  align: CanvasTextAlign = "left",
): void {
  ctx.font = `${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(value, x, y);
}
function tracked(
  ctx: Context,
  value: string,
  x: number,
  y: number,
  size: number,
  spacing: number,
  color = P.dim,
): void {
  ctx.font = `${size}px ${FONT}`;
  const width = ctx.measureText(value).width + (value.length - 1) * spacing;
  let left = x - width / 2;
  for (const char of value) {
    text(ctx, char, left, y, size, color);
    left += ctx.measureText(char).width + spacing;
  }
}
function line(
  ctx: Context,
  x: number,
  y: number,
  x2: number,
  y2: number,
  color = P.line,
  width = 1,
): void {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.moveTo(x, y);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
function circle(
  ctx: Context,
  x: number,
  y: number,
  radius: number,
  color: string,
  width = 1,
): void {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
}
function glow(
  ctx: Context,
  p: Readonly<Point>,
  radius: number,
  color: string,
): void {
  const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, "transparent");
  ctx.fillStyle = gradient;
  ctx.fillRect(p.x - radius, p.y - radius, radius * 2, radius * 2);
}
function sprite(
  ctx: Context,
  s: ReadState,
  sheet: string,
  frame: number,
  x: number,
  y: number,
  size = C.TILE,
): void {
  const image = s.art[sheet]?.[frame];
  if (image) ctx.drawImage(image, x - size / 2, y - size / 2, size, size);
}
const facing = (dir: Direction): number =>
  ({ down: 0, up: 2, left: 4, right: 6 })[dir];
function amber(ctx: Context, p: Readonly<Point>): void {
  glow(ctx, p, 18, "#fc78484a");
  ctx.fillStyle = P.amber;
  ctx.shadowColor = P.amber;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}
function frame(ctx: Context): void {
  line(ctx, 64, 79, 1216, 79);
  line(ctx, 64, 656, 1216, 656);
  for (const x of [64, 1216])
    for (const y of [80, 656]) {
      line(ctx, x, y, x + (x === 64 ? 12 : -12), y, P.dim);
      line(ctx, x, y, x, y + (y === 80 ? 12 : -12), P.dim);
    }
  for (let y = 112; y <= 624; y += 32) {
    line(ctx, 43, y, y % 64 === 48 ? 52 : 48, y, P.faint);
    line(ctx, 1232, y, y % 64 === 48 ? 1241 : 1236, y, P.faint);
  }
}

function terrain(ctx: Context, s: ReadState): void {
  for (let ty = 0; ty < C.GRID_ROWS; ty++)
    for (let tx = 0; tx < C.GRID_COLS; tx++) {
      const vis = s.visibility[ty][tx];
      const p = center(tx, ty);
      if (vis === "u") continue;
      const tile = s.tiles[ty][tx];
      let index = tile === "g" ? 18 : 16;
      if (tile === "#")
        index =
          (s.tiles[ty - 1]?.[tx] === "#" ? 1 : 0) +
          (s.tiles[ty]?.[tx + 1] === "#" ? 2 : 0) +
          (s.tiles[ty + 1]?.[tx] === "#" ? 4 : 0) +
          (s.tiles[ty]?.[tx - 1] === "#" ? 8 : 0);
      sprite(ctx, s, "trench-walls", index, p.x, p.y);
      if (vis === "r") {
        ctx.fillStyle = "#02090eb8";
        ctx.fillRect(p.x - C.TILE / 2, p.y - C.TILE / 2, C.TILE, C.TILE);
      }
      if (s.plankton[ty][tx] === "*") {
        ctx.fillStyle = vis === "l" ? "#9beed4" : "#35564e";
        ctx.shadowColor = P.cyan;
        ctx.shadowBlur = vis === "l" ? 9 : 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, C.PLANKTON_DOT / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
}
function discClip(ctx: Context, p: Readonly<Point>, radius: number): void {
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.clip();
}
function maze(ctx: Context, s: ReadState): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    C.GRID_ORIGIN_X,
    C.GRID_ORIGIN_Y,
    C.GRID_COLS * C.TILE,
    C.GRID_ROWS * C.TILE,
  );
  ctx.clip();
  for (let y = 0; y < C.GRID_ROWS; y++)
    for (let x = 0; x < C.GRID_COLS; x++) {
      const p = center(x, y);
      sprite(ctx, s, "trench-walls", 17, p.x, p.y);
    }
  ctx.save();
  discClip(ctx, s.forager, s.windowRadius);
  terrain(ctx, s);
  glow(ctx, s.forager, s.windowRadius, "#40ead40b");
  s.drifters.forEach((d) => amber(ctx, d));
  s.predators
    .filter((p) => p.kind === "lanternjaw" && p.state !== "den")
    .forEach((p) => amber(ctx, p));
  ctx.restore();
  // A bloom is full vision outside the Kindle window as well as within it.
  for (const f of s.predators.filter((p) => p.flaring && p.state !== "den")) {
    ctx.save();
    discClip(ctx, f, C.FLARE_RADIUS);
    terrain(ctx, s);
    ctx.restore();
  }
  for (const cloud of s.inkClouds) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, cloud.remaining / 0.4);
    ctx.fillStyle = P.ink;
    ctx.beginPath();
    ctx.arc(cloud.x, cloud.y, cloud.radius, 0, Math.PI * 2);
    ctx.fill();
    glow(ctx, cloud, cloud.radius * 1.2, "#000307cc");
    ctx.restore();
  }
  const swim = Math.floor(s.simTime * 8) % 2;
  for (const d of s.drifters)
    if (d.lit)
      sprite(ctx, s, "drifter", Math.floor(s.simTime * 8) % 8, d.x, d.y);
  for (const p of s.predators) {
    if (p.state === "den") continue;
    if (p.lit) {
      ctx.save();
      const naturallyLit = s.visibility[p.ty]?.[p.tx] === "l";
      if (!naturallyLit && !p.alert && p.markLeft > 0)
        ctx.globalAlpha = Math.min(1, p.markLeft / 0.5);
      sprite(
        ctx,
        s,
        p.kind,
        p.kind === "lanternjaw" && p.state === "wander"
          ? 8 + (Math.floor(s.simTime * 8) % 8)
          : facing(p.dir) + swim,
        p.x,
        p.y,
      );
      ctx.restore();
    }
    if (p.flareCharging || p.flaring || p.fadeLeft > 0) {
      const index = p.flareCharging
        ? Math.min(2, Math.floor((1 - p.chargeLeft / C.FLARE_CHARGE) * 3))
        : p.flaring
          ? 3 + Math.min(2, Math.floor((1 - p.bloomLeft / C.FLARE_BLOOM) * 3))
          : p.fadeLeft > 0.2
            ? 6
            : 7;
      sprite(ctx, s, "flare-bloom", index, p.x, p.y, C.FLARE_RADIUS * 2);
    }
    if (p.alert) {
      const age = 1 - p.alertLeft / C.ALERT_TIME;
      const color = p.kind === "gloamfin" ? P.violet : P.orange;
      ctx.save();
      ctx.globalAlpha = 1 - age;
      circle(ctx, p.x, p.y, 16 + age * 35, color, 2);
      for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI) / 4;
        const r = 21 + age * 35;
        line(
          ctx,
          p.x + Math.cos(angle) * r,
          p.y + Math.sin(angle) * r,
          p.x + Math.cos(angle) * (r + 9),
          p.y + Math.sin(angle) * (r + 9),
          color,
          2,
        );
      }
      ctx.restore();
    }
  }
  for (const pulse of s.pulses) {
    const color =
      pulse.tint === "cyan"
        ? P.cyan
        : pulse.tint === "violet"
          ? P.violet
          : P.orange;
    const distances = pulseDistances(s, pulse);
    ctx.save();
    ctx.shadowBlur = 16;
    ctx.shadowColor = color;
    for (const [key, d] of distances) {
      const age = pulse.front - d;
      if (d > pulse.range || age < 0 || age > 1.6) continue;
      const [tx, ty] = key.split(",").map(Number);
      const p = center(tx, ty);
      ctx.globalAlpha = (1 - age / 1.6) * 0.8;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x - 12, p.y - 12, 24, 24);
      ctx.globalAlpha *= 0.2;
      ctx.fillStyle = color;
      ctx.fillRect(p.x - 14, p.y - 14, 28, 28);
    }
    ctx.restore();
  }
  glow(ctx, s.forager, 40 + s.brightness * 20, "#54f8d841");
  sprite(
    ctx,
    s,
    "glimmerfin",
    facing(s.forager.dir) +
      (s.forager.moving ? Math.floor(s.simTime * 9) % 2 : 0),
    s.forager.x,
    s.forager.y,
  );
  ctx.restore();
  frame(ctx);
}
function gauge(
  ctx: Context,
  x: number,
  label: string,
  key: string,
  cooldown: number,
  max: number,
  color: string,
): void {
  text(ctx, key, x, 687, 12, P.dim);
  text(ctx, label, x + 53, 685, 13, cooldown === 0 ? color : P.dim);
  text(
    ctx,
    cooldown === 0 ? "READY" : `${cooldown.toFixed(1)}s`,
    x + 227,
    685,
    11,
    cooldown === 0 ? color : P.dim,
    "right",
  );
  ctx.fillStyle = P.line;
  ctx.fillRect(x + 53, 696, 174, 3);
  ctx.fillStyle = color;
  ctx.fillRect(x + 53, 696, 174 * Math.max(0, 1 - cooldown / max), 3);
}
function hud(ctx: Context, s: ReadState): void {
  text(ctx, C.TITLE_TEXT, 64, 36, 26, P.text);
  text(ctx, `${C.DIVE_LABEL} / 0${s.depth}`, 65, 60, 11, P.dim);
  text(ctx, "LIGHT SIGNATURE", 324, 30, 10, P.dim);
  for (let i = 0; i < 24; i++) {
    ctx.fillStyle = i / 24 < s.brightness ? P.cyan : P.line;
    ctx.fillRect(324 + i * 5, 43, 3, 12);
  }
  text(ctx, "PLANKTON", 650, 30, 10, P.dim);
  text(ctx, String(s.planktonRemaining).padStart(3, "0"), 650, 57, 23, P.text);
  text(ctx, "SCORE", 880, 33, 10, P.dim);
  text(ctx, String(s.score).padStart(6, "0"), 1216, 59, 48, P.text, "right");
  text(ctx, `DEPTH ${s.depth}`, 64, 689, 14, P.text);
  line(ctx, 180, 675, 180, 702);
  for (let i = 0; i < s.lives; i++)
    sprite(ctx, s, "glimmerfin", 6, 214 + i * 29, 688, 24);
  gauge(ctx, 400, "SONAR", "SPACE", s.sonar.cooldown, C.SONAR_COOLDOWN, P.cyan);
  gauge(ctx, 698, "INK", "SHIFT", s.ink.cooldown, C.INK_COOLDOWN, P.blue);
  text(ctx, "P  PAUSE", 1216, 682, 11, P.dim, "right");
  text(
    ctx,
    `M  ${s.muted ? "SOUND OFF" : "SOUND ON"}`,
    1216,
    701,
    10,
    P.dim,
    "right",
  );
}
function menu(ctx: Context, s: ReadState): void {
  menuItems(s).forEach((item, i) => {
    const r = menuItemRect(s, i)!;
    const active = s.menuIndex === i;
    ctx.fillStyle = active ? "#102a2e" : "#050f16";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = active ? "#4bc1b0" : P.line;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    if (active) {
      ctx.fillStyle = P.cyan;
      ctx.fillRect(r.x, r.y, 3, r.h);
      text(ctx, "›", r.x + 22, r.y + 32, 21, P.cyan);
    }
    tracked(ctx, item, r.x + r.w / 2, r.y + 31, 16, 3, active ? P.text : P.dim);
    if (active) text(ctx, "↵", r.x + r.w - 25, r.y + 31, 17, P.cyan, "center");
  });
}
function particles(ctx: Context, time: number): void {
  for (let i = 0; i < 85; i++) {
    const x = (i * 277.31) % C.STAGE_W;
    const y = (i * 91.67 - time * (2 + (i % 3)) + C.STAGE_H * 100) % C.STAGE_H;
    ctx.fillStyle = i % 9 === 0 ? "#467a794f" : "#294c4f35";
    ctx.fillRect(x, y, i % 9 === 0 ? 2 : 1, i % 9 === 0 ? 2 : 1);
  }
}
function masthead(ctx: Context, right: string): void {
  line(ctx, 64, 74, 1216, 74);
  circle(ctx, 77, 44, 10, P.cyan);
  circle(ctx, 77, 44, 4, P.cyan);
  line(ctx, 77, 29, 77, 59, P.cyan);
  tracked(ctx, "ABYSSAL FIELD NOTES", 222, 48, 11, 2, P.dim);
  text(ctx, right, 1216, 48, 11, P.dim, "right");
}
function title(ctx: Context, s: ReadState): void {
  particles(ctx, s.simTime);
  masthead(ctx, `DIVE 01 / ${C.DIVE_LABEL}`);
  glow(ctx, { x: 640, y: 287 }, 360, "#16443f38");
  for (const r of [93, 151, 214, 278]) circle(ctx, 640, 287, r, "#183a3b70");
  ctx.save();
  ctx.setLineDash([2, 12]);
  circle(ctx, 640, 287, 247, "#29505177");
  ctx.restore();
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    line(
      ctx,
      640 + Math.cos(a) * 271,
      287 + Math.sin(a) * 271,
      640 + Math.cos(a) * 282,
      287 + Math.sin(a) * 282,
      P.faint,
    );
  }
  // A cartographic silhouette made from the actual trench art.
  ctx.save();
  ctx.globalAlpha = 0.24;
  for (let ty = 3; ty <= 14; ty++)
    for (let tx = 3; tx <= 32; tx++) {
      const p = center(tx, ty);
      const d = distance(p, { x: 640, y: 285 });
      if (d < 175 || d > 470 || s.tiles[ty][tx] !== "#") continue;
      const mask =
        (s.tiles[ty - 1]?.[tx] === "#" ? 1 : 0) +
        (s.tiles[ty]?.[tx + 1] === "#" ? 2 : 0) +
        (s.tiles[ty + 1]?.[tx] === "#" ? 4 : 0) +
        (s.tiles[ty]?.[tx - 1] === "#" ? 8 : 0);
      sprite(ctx, s, "trench-walls", mask, p.x, p.y);
    }
  ctx.restore();
  tracked(ctx, "A BIOLUMINESCENT MAZE CHASE", 640, 180, 11, 4, P.dim);
  ctx.save();
  ctx.shadowColor = "#68e5d74a";
  ctx.shadowBlur = 38;
  tracked(ctx, C.TITLE_TEXT, 640, 310, 132, 16, P.text);
  ctx.restore();
  tracked(ctx, C.TAGLINE_TEXT, 640, 358, 17, 7, P.cyan);
  text(
    ctx,
    "Carry a little light. Attract the wrong attention.",
    640,
    398,
    13,
    P.dim,
    "center",
  );
  menu(ctx, s);
  const predators = [
    {
      sheet: "lanternjaw",
      frame: 0,
      name: "LANTERNJAW",
      sense: "FOLLOWS YOUR LIGHT",
      color: P.amber,
    },
    {
      sheet: "gloamfin",
      frame: 6,
      name: "GLOAMFIN",
      sense: "LISTENS FOR YOUR SONAR",
      color: P.violet,
    },
    {
      sheet: "flarefish",
      frame: 4,
      name: "FLAREFISH",
      sense: "HUNTS IN A FLASH",
      color: P.orange,
    },
  ];
  line(ctx, 220, 576, 1060, 576);
  predators.forEach((p, i) => {
    const x = 290 + i * 300;
    sprite(ctx, s, p.sheet, p.frame, x - 34, 616, 40);
    text(ctx, p.name, x, 608, 12, p.color);
    text(ctx, p.sense, x, 630, 9, P.dim);
  });
  line(ctx, 64, 664, 1216, 664);
  text(ctx, "↑ ↓  SELECT    ENTER  CONFIRM", 64, 693, 10, P.dim);
  text(
    ctx,
    "THE DEEP REMEMBERS. YOUR LIGHT DOESN’T REACH FOREVER.",
    1216,
    693,
    10,
    P.dim,
    "right",
  );
}
function howto(ctx: Context, s: ReadState): void {
  particles(ctx, s.simTime);
  masthead(ctx, "FIELD GUIDE / 01");
  tracked(ctx, "LEARN THE DARK", 640, 145, 36, 5, P.text);
  text(
    ctx,
    "You are a small light in a very hungry ocean.",
    640,
    181,
    14,
    P.dim,
    "center",
  );
  const x = 93;
  text(ctx, "01 / FIND YOUR WAY", x, 241, 13, P.cyan);
  text(ctx, "ARROWS / WASD", x, 282, 17);
  text(ctx, "Swim. Hold to move; release to stop.", x, 309, 13, P.dim);
  text(ctx, "SPACE", x, 357, 17);
  text(
    ctx,
    "Send sonar around corners. See the route ahead.",
    x,
    384,
    13,
    P.dim,
  );
  text(ctx, "SHIFT", x, 432, 17);
  text(ctx, "Leave ink behind. Blind the hunters that see.", x, 459, 13, P.dim);
  text(ctx, "ESC / P   PAUSE       M   MUTE", x, 513, 12, P.dim);
  line(ctx, 619, 221, 619, 538);
  const guides = [
    {
      sheet: "lanternjaw",
      title: "LANTERNJAW / LIGHT",
      color: P.amber,
      lines: [
        "An amber glimmer could be food. Or jaws.",
        "Eat to glow brighter — and be seen farther.",
      ],
    },
    {
      sheet: "gloamfin",
      title: "GLOAMFIN / SOUND",
      color: P.violet,
      lines: [
        "Your sonar reveals it. Your sonar calls it.",
        "Turn corners to shake its fast pursuit.",
      ],
    },
    {
      sheet: "flarefish",
      title: "FLAREFISH / FLASH",
      color: P.orange,
      lines: [
        "A warm glow warns you. Then the dark ignites.",
        "Swim clear before its bloom catches you.",
      ],
    },
  ];
  guides.forEach((p, i) => {
    const y = 250 + i * 108;
    sprite(ctx, s, p.sheet, 6, 669, y + 9, 42);
    text(ctx, p.title, 711, y, 13, p.color);
    p.lines.forEach((v, j) => text(ctx, v, 711, y + 27 + j * 20, 11, P.dim));
  });
  line(ctx, 93, 557, 1187, 557);
  text(
    ctx,
    "Graze every mote to descend. Eating grows your window into the dark.",
    640,
    593,
    13,
    P.text,
    "center",
  );
  text(
    ctx,
    "Explored ground stays remembered, but only nearby ground stays in view. Sonar reaches farther.",
    640,
    619,
    11,
    P.dim,
    "center",
  );
  tracked(ctx, "ENTER / ESC / TAP ANYWHERE TO RETURN", 640, 680, 11, 2, P.cyan);
}
function overlay(ctx: Context, s: ReadState): void {
  if (s.screen === "countdown") {
    ctx.fillStyle = "#02090e96";
    ctx.fillRect(440, 263, 400, 176);
    tracked(ctx, C.TITLE_ITEMS[0], 640, 314, 20, 8, P.cyan);
    text(
      ctx,
      String(Math.max(1, Math.ceil(s.screenLeft))),
      640,
      385,
      62,
      P.text,
      "center",
    );
    tracked(ctx, "LET YOUR LIGHT LEAD", 640, 421, 10, 3, P.dim);
  } else if (s.screen === "cleared") {
    ctx.fillStyle = "#02090eea";
    ctx.fillRect(310, 271, 660, 176);
    tracked(ctx, `DEPTH ${s.depth} CLEARED`, 640, 329, 30, 3, P.text);
    tracked(ctx, `+${C.SCORE_CLEAR} / DESCENDING`, 640, 378, 14, 3, P.cyan);
    line(ctx, 480, 411, 800, 411);
    ctx.fillStyle = P.cyan;
    ctx.fillRect(480, 410, 320 * (1 - s.screenLeft / 2), 2);
  } else if (s.screen === "paused") {
    ctx.fillStyle = "#02090eaa";
    ctx.fillRect(64, 80, 1152, 576);
    ctx.fillStyle = "#061118f2";
    ctx.fillRect(408, 211, 464, 374);
    ctx.strokeStyle = P.line;
    ctx.strokeRect(408.5, 211.5, 463, 373);
    tracked(ctx, "SUSPENDED", 640, 273, 29, 4, P.text);
    tracked(ctx, "THE DEEP CAN WAIT", 640, 308, 10, 3, P.dim);
    menu(ctx, s);
  }
}
function gameover(ctx: Context, s: ReadState): void {
  particles(ctx, s.simTime);
  masthead(ctx, "SIGNAL LOST");
  circle(ctx, 640, 303, 220, P.line);
  circle(ctx, 640, 303, 250, "#112229");
  tracked(ctx, "EXTINGUISHED", 640, 214, 44, 4, P.text);
  tracked(ctx, `DEPTH ${s.depth} REACHED`, 640, 260, 12, 3, P.dim);
  text(ctx, String(s.score).padStart(6, "0"), 640, 321, 46, P.cyan, "center");
  menu(ctx, s);
  text(
    ctx,
    "There is always another light in the deep.",
    640,
    555,
    13,
    P.dim,
    "center",
  );
}

export function render(s: ReadState, ctx: Context): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = P.bg;
  ctx.fillRect(0, 0, C.STAGE_W, C.STAGE_H);
  if (s.screen === "title") title(ctx, s);
  else if (s.screen === "howto") howto(ctx, s);
  else if (s.screen === "gameover") gameover(ctx, s);
  else {
    maze(ctx, s);
    hud(ctx, s);
    overlay(ctx, s);
  }
  ctx.restore();
}
