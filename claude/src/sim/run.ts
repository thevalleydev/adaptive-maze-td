import { writeFileSync, mkdirSync } from 'fs';
import { config } from '../config';
import { runGame } from './metrics';
import { StaticPolicy, ReactivePolicy, SealPolicy, MonoPolicy, LAYOUTS } from './policies';
import { runSweep, SweepRow } from './sweep';

const argv = process.argv.slice(2);
const has = (flag: string) => argv.includes(flag);
const val = (flag: string) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};

function pad(s: string | number, n: number) {
  return String(s).padEnd(n);
}

if (has('--sweep')) {
  console.log(`Sweeping… target=wave ${config.targetWave}\n`);
  const rows = runSweep();

  // Console table sorted by how far static play gets (the wall).
  const hdr = ['policy', 'heal', 'cost+', 'pRate', 'rwd', 'won', 'cleared', 'wall', 'lives', 'wrecked', 'cracks'];
  const widths = [16, 5, 6, 6, 5, 4, 8, 5, 6, 8, 7];
  console.log(hdr.map((h, i) => pad(h, widths[i])).join(''));
  console.log('-'.repeat(widths.reduce((a, b) => a + b, 0)));
  const sorted = [...rows].sort((a, b) => a.wavesCleared - b.wavesCleared || a.policy.localeCompare(b.policy));
  for (const r of sorted) {
    console.log(
      [
        pad(r.policy, widths[0]),
        pad(r.rubbleHealTime, widths[1]),
        pad(r.towerCostGrowth, widths[2]),
        pad(r.pressureRate, widths[3]),
        pad(r.killRewardMult, widths[4]),
        pad(r.won ? 'Y' : 'n', widths[5]),
        pad(r.wavesCleared, widths[6]),
        pad(r.firstLeakWave ?? '-', widths[7]),
        pad(r.livesRemaining, widths[8]),
        pad(r.towersWrecked, widths[9]),
        pad(r.cracksPersisted ? 'Y' : 'n', widths[10]),
      ].join(''),
    );
  }

  mkdirSync('sim', { recursive: true });
  writeFileSync('sim/results.json', JSON.stringify(rows, null, 2));
  const cols = Object.keys(rows[0]) as (keyof SweepRow)[];
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => r[c]).join(','))].join('\n');
  writeFileSync('sim/results.csv', csv);
  console.log(`\nWrote sim/results.json and sim/results.csv (${rows.length} runs)`);
} else {
  // Single config (current defaults) — run each policy once.
  const layout = val('--layout');
  const policyArg = val('--policy');
  const policies = policyArg === 'reactive'
    ? [new ReactivePolicy()]
    : policyArg === 'seal'
      ? [new SealPolicy()]
      : policyArg === 'mono'
        ? [new MonoPolicy((val('--tower') as any) ?? 'gun')]
        : layout
          ? [new StaticPolicy(layout as keyof typeof LAYOUTS)]
          : [
              ...Object.keys(LAYOUTS).map((l) => new StaticPolicy(l as keyof typeof LAYOUTS)),
              new ReactivePolicy(),
              new SealPolicy(),
              new MonoPolicy(),
            ];

  console.log(`Single run @ defaults · target=wave ${config.targetWave}\n`);
  const hdr = ['policy', 'won', 'cleared', 'wall', 'lives', 'kills', 'wrecked', 'climb', 'bomb', 'armor'];
  const widths = [16, 4, 8, 5, 6, 6, 8, 6, 6, 8];
  console.log(hdr.map((h, i) => pad(h, widths[i])).join(''));
  console.log('-'.repeat(widths.reduce((a, b) => a + b, 0)));
  for (const p of policies) {
    const r = runGame(p);
    console.log(
      [
        pad(r.policy, widths[0]),
        pad(r.won ? 'Y' : 'n', widths[1]),
        pad(r.wavesCleared, widths[2]),
        pad(r.firstLeakWave ?? '-', widths[3]),
        pad(r.livesRemaining, widths[4]),
        pad(r.kills, widths[5]),
        pad(r.towersWrecked, widths[6]),
        pad(r.learnedClimb ? 'Y' : 'n', widths[7]),
        pad(r.learnedBomb ? 'Y' : 'n', widths[8]),
        pad(r.learnedArmor ? r.armorType ?? 'Y' : 'n', widths[9]),
      ].join(''),
    );
  }
}
