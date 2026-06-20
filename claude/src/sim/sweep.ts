import { config, Config } from '../config';
import { runGame, Metrics } from './metrics';
import { StaticPolicy, ReactivePolicy, LAYOUTS } from './policies';

export interface SweepRow extends Metrics {
  // the swept knob values for this run
  rubbleHealTime: number;
  towerCostGrowth: number;
  pressureRate: number;
  killRewardMult: number;
}

// Knobs to vary and the values to try. Keep small — runtime is product of all.
export const SWEEP_AXES: Partial<Record<keyof Config, number[]>> = {
  rubbleHealTime: [0, 12],
  towerCostGrowth: [0, 0.12],
  pressureRate: [9, 14],
  killRewardMult: [1, 0.6],
};

function makePolicies() {
  return [
    ...Object.keys(LAYOUTS).map((l) => new StaticPolicy(l as keyof typeof LAYOUTS)),
    new ReactivePolicy(),
  ];
}

function cartesian(axes: [keyof Config, number[]][]): Partial<Config>[] {
  let combos: Partial<Config>[] = [{}];
  for (const [key, values] of axes) {
    const next: Partial<Config>[] = [];
    for (const c of combos) for (const v of values) next.push({ ...c, [key]: v });
    combos = next;
  }
  return combos;
}

// Run every (config combo × policy) and return one row each. Mutates the shared
// `config` singleton per run and restores it afterward.
export function runSweep(): SweepRow[] {
  const axes = Object.entries(SWEEP_AXES) as [keyof Config, number[]][];
  const combos = cartesian(axes);
  const rows: SweepRow[] = [];
  const original = { ...config };

  for (const combo of combos) {
    Object.assign(config, combo);
    for (const policy of makePolicies()) {
      const m = runGame(policy);
      rows.push({
        ...m,
        rubbleHealTime: config.rubbleHealTime,
        towerCostGrowth: config.towerCostGrowth,
        pressureRate: config.pressureRate,
        killRewardMult: config.killRewardMult,
      });
    }
  }

  Object.assign(config, original);
  return rows;
}
