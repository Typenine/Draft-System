import { getAllPlayersCached, getLeagueMatchups, type SleeperMatchup, type SleeperPlayer, buildYearToLeagueMapUnique } from '@/lib/utils/sleeper-api';

export type WPCalibrationBucket = { range: [number, number]; a: number; b: number; n: number };
export type WPModel = {
  trainedAt: string;
  buckets: WPCalibrationBucket[];
  posDefaults: { mean: Record<string, number>; sd: Record<string, number> };
};

const POS_DEFAULT_MEAN: Record<string, number> = { QB: 18, RB: 13, WR: 13, TE: 8, K: 8, DEF: 8 };
const POS_DEFAULT_SD: Record<string, number> = { QB: 8, RB: 7, WR: 7, TE: 5, K: 4, DEF: 6 };

function clamp01(x: number) { return Math.max(0.000001, Math.min(0.999999, x)); }
function sigmoid(z: number) { return 1 / (1 + Math.exp(-z)); }
function logit(p: number) { const pp = clamp01(p); return Math.log(pp / (1 - pp)); }

function trainPlattScaling(z: number[], y: number[], steps = 300, lr = 0.05): { a: number; b: number } {
  // Logistic regression with single predictor z, optimize a,b via gradient descent
  let a = 1, b = 0;
  const n = z.length;
  for (let it = 0; it < steps; it++) {
    let gA = 0, gB = 0;
    for (let i = 0; i < n; i++) {
      const p = sigmoid(a * z[i] + b);
      const err = p - y[i];
      gA += err * z[i];
      gB += err;
    }
    gA /= n; gB /= n;
    a -= lr * gA;
    b -= lr * gB;
  }
  return { a, b };
}

function sampleFractions(): number[] { return [0.9, 0.7, 0.5, 0.3, 0.1]; }

// Approximate error function (erf) using Abramowitz and Stegun formula 7.1.26
function erfApprox(x: number): number {
  // Save the sign of x
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  // Coefficients
  const p = 0.3275911;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(x: number): number {
  return 0.5 * (1 + erfApprox(x / Math.SQRT2));
}

function asPairs(matchups: SleeperMatchup[]): SleeperMatchup[][] {
  const byId = new Map<number, SleeperMatchup[]>();
  for (const m of matchups) {
    const arr = byId.get(m.matchup_id) || [];
    arr.push(m);
    byId.set(m.matchup_id, arr);
  }
  return Array.from(byId.values()).filter((arr) => arr.length >= 2);
}

function posOf(pid: string, players: Record<string, SleeperPlayer>): string {
  const p = players[pid];
  return (p?.position || '').toUpperCase();
}

function buildStarters(m: SleeperMatchup): string[] {
  return ((m.starters || []) as string[]).filter((id) => id && id !== '0');
}

function countPosMeans(starters: string[], players: Record<string, SleeperPlayer>): { mean: number; sd2: number } {
  let mean = 0; let sd2 = 0;
  for (const id of starters) {
    const pos = posOf(id, players);
    const mu = POS_DEFAULT_MEAN[pos] ?? 10;
    const sd = POS_DEFAULT_SD[pos] ?? 6;
    mean += mu;
    sd2 += sd * sd;
  }
  return { mean, sd2 };
}

export async function trainWPModel(): Promise<WPModel> {
  const yearToLeague = await buildYearToLeagueMapUnique();
  const players = await getAllPlayersCached().catch(() => ({} as Record<string, SleeperPlayer>));

  // Dataset buckets by fraction remaining
  const buckets: { lo: number; hi: number; z: number[]; y: number[] }[] = [
    { lo: 0.8, hi: 1.01, z: [], y: [] },
    { lo: 0.6, hi: 0.8, z: [], y: [] },
    { lo: 0.4, hi: 0.6, z: [], y: [] },
    { lo: 0.2, hi: 0.4, z: [], y: [] },
    { lo: 0.0, hi: 0.2, z: [], y: [] },
  ];

  for (const leagueId of Object.values(yearToLeague)) {
    if (!leagueId) continue;
    // Gather all weeks
    const allWeeks: SleeperMatchup[][] = [];
    for (let w = 1; w <= 17; w++) {
      try {
        const mus = await getLeagueMatchups(leagueId, w);
        allWeeks.push(mus);
      } catch { /* ignore */ }
    }
    const pairs = allWeeks.flatMap(asPairs);

    for (const pair of pairs) {
      const [a, b] = pair;
      const aFinal = Number(a.custom_points ?? a.points ?? 0);
      const bFinal = Number(b.custom_points ?? b.points ?? 0);
      if (!isFinite(aFinal) || !isFinite(bFinal)) continue;
      if (aFinal === 0 && bFinal === 0) continue;
      const y = aFinal > bFinal ? 1 : aFinal < bFinal ? 0 : 0.5; // ties -> 0.5
      const aStarters = buildStarters(a);
      const bStarters = buildStarters(b);
      const aCnt = countPosMeans(aStarters, players);
      const bCnt = countPosMeans(bStarters, players);

      for (const t of sampleFractions()) {
        // Approx snapshot: completed fraction = 1 - t
        const comp = 1 - t;
        const aCur = aFinal * comp;
        const bCur = bFinal * comp;
        // Expected remainder from positional means scaled by t
        const aRem = aCnt.mean * t;
        const bRem = bCnt.mean * t;
        const aPred = aCur + aRem;
        const bPred = bCur + bRem;
        // Variance approx from positional sd, scaled by t
        const varDiff = (aCnt.sd2 + bCnt.sd2) * Math.max(0.05, t);
        const k = Math.sqrt(Math.max(1, varDiff));
        const diff = aPred - bPred;
        // Raw probability proxy ~ Normal CDF
        const pRaw = normalCdf(diff / k);
        const zi = logit(pRaw);
        // Place in bucket by t
        const bucket = buckets.find((bkt) => t >= bkt.lo && t < bkt.hi);
        if (bucket) { bucket.z.push(zi); bucket.y.push(y); }
      }
    }
  }

  const outBuckets: WPCalibrationBucket[] = buckets.map((b) => {
    if (b.z.length >= 10) {
      const { a, b: bb } = trainPlattScaling(b.z, b.y);
      return { range: [b.lo, b.hi], a, b: bb, n: b.z.length };
    }
    return { range: [b.lo, b.hi], a: 1, b: 0, n: b.z.length };
  });

  return {
    trainedAt: new Date().toISOString(),
    buckets: outBuckets,
    posDefaults: { mean: POS_DEFAULT_MEAN, sd: POS_DEFAULT_SD },
  };
}

export function applyCalibration(rawP: number, fracRemaining: number, model: WPModel): number {
  const z = logit(clamp01(rawP));
  const bkt = model.buckets.find((b) => fracRemaining >= b.range[0] && fracRemaining < b.range[1]) || model.buckets[0];
  const p = sigmoid(bkt.a * z + bkt.b);
  return clamp01(p);
}
