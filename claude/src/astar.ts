import { config } from './config';
import { Grid, Tile } from './grid';

export interface Pt {
  x: number;
  y: number;
}

// 4-directional A* over the grid. Rock is always impassable. Towers/walls are
// impassable when wallCost === Infinity (default — naive creeps), else passable
// at that extra cost (creeps that have learned to climb/bomb).
//
// pressureBias scales how pressure affects cost: positive (default) makes hot
// tiles EXPENSIVE so creeps route around them; negative makes them CHEAP so
// crack-seeking creeps are drawn toward soon-to-collapse ground. Returns tile
// centers, or null.
export function findPath(grid: Grid, start: Pt, goal: Pt, wallCost = Infinity, pressureBias = config.pressureAvoidance): Pt[] | null {
  const startT = grid.at(start.x, start.y);
  const goalT = grid.at(goal.x, goal.y);
  if (!startT || !goalT) return null;

  const n = grid.cols * grid.rows;
  const gScore = new Float64Array(n).fill(Infinity);
  const fScore = new Float64Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);

  const h = (x: number, y: number) => Math.abs(x - goal.x) + Math.abs(y - goal.y);
  const startIdx = grid.idx(start.x, start.y);
  gScore[startIdx] = 0;
  fScore[startIdx] = h(start.x, start.y);

  // Simple binary heap of tile indices keyed on fScore.
  const heap: number[] = [startIdx];
  const less = (a: number, b: number) => fScore[a] < fScore[b];
  const push = (i: number) => {
    heap.push(i);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (less(heap[c], heap[p])) {
        [heap[c], heap[p]] = [heap[p], heap[c]];
        c = p;
      } else break;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let p = 0;
      for (;;) {
        const l = 2 * p + 1;
        const r = 2 * p + 2;
        let s = p;
        if (l < heap.length && less(heap[l], heap[s])) s = l;
        if (r < heap.length && less(heap[r], heap[s])) s = r;
        if (s === p) break;
        [heap[p], heap[s]] = [heap[s], heap[p]];
        p = s;
      }
    }
    return top;
  };

  const goalIdx = grid.idx(goal.x, goal.y);
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  while (heap.length) {
    const cur = pop();
    if (cur === goalIdx) break;
    if (closed[cur]) continue;
    closed[cur] = 1;

    const cx = cur % grid.cols;
    const cy = (cur / grid.cols) | 0;

    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      const nt: Tile | null = grid.at(nx, ny);
      if (!nt || nt.rock) continue; // rock never passable
      const structure = nt.blocked; // tower/wall
      if (structure && wallCost === Infinity) continue;
      const ni = grid.idx(nx, ny);
      if (closed[ni]) continue;
      // Step cost = terrain + (wall crossing) + pressure bias. Clamp ≥ 0.05 so a
      // strong negative bias never produces negative edges (A* needs non-negative).
      let step = grid.enterCost(nt) + (structure ? wallCost : 0) + pressureBias * (nt.pressure / config.collapseThreshold);
      if (step < 0.05) step = 0.05;
      const tentative = gScore[cur] + step;
      if (tentative < gScore[ni]) {
        cameFrom[ni] = cur;
        gScore[ni] = tentative;
        fScore[ni] = tentative + h(nx, ny);
        push(ni);
      }
    }
  }

  if (cameFrom[goalIdx] === -1 && goalIdx !== startIdx) return null;

  const path: Pt[] = [];
  let c = goalIdx;
  while (c !== -1) {
    path.push({ x: c % grid.cols, y: (c / grid.cols) | 0 });
    if (c === startIdx) break;
    c = cameFrom[c];
  }
  path.reverse();
  return path;
}
