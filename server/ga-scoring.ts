// server/ga-scoring.ts - GA Load Scoring
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

interface GALoad {
  rpm?: number;
  deadhead_miles?: number;
  pickup_dt?: string;
  equipment?: string;
  origin_state?: string;
  dest_state?: string;
  [key: string]: any;
}

interface ScoringOptions {
  minRPM?: number;
  idealRPM?: number;
  maxRPM?: number;
}

export function scoreLoad(load: GALoad, opts: ScoringOptions = {}): number {
  const minRPM = Number(opts.minRPM ?? 1.80);
  const maxRPM = Number(opts.maxRPM ?? 3.25);

  const rpm = Number(load.rpm ?? 0);
  const deadhead = Number(load.deadhead_miles ?? 0);

  // RPM score (0–50)
  let rpmScore = 0;
  if (rpm > 0) {
    const t = (rpm - minRPM) / (maxRPM - minRPM);
    rpmScore = clamp(Math.round(t * 50), 0, 50);
  }

  // Deadhead penalty (0 to -20) based on 0..200 miles
  const deadheadPenalty = clamp(Math.round((deadhead / 200) * 20), 0, 20);

  // Pickup urgency bonus (0–10): within 24h -> 10, within 48h -> 5, else 0
  let urgencyBonus = 0;
  if (load.pickup_dt) {
    const now = Date.now();
    const pickup = Date.parse(load.pickup_dt);
    if (!Number.isNaN(pickup)) {
      const hours = (pickup - now) / (1000 * 60 * 60);
      if (hours <= 24) urgencyBonus = 10;
      else if (hours <= 48) urgencyBonus = 5;
    }
  }

  // Equipment fit bonus (0–10)
  let equipmentBonus = 5;
  const eq = (load.equipment || "").toLowerCase();
  if (eq.includes("box") || eq.includes("sprinter") || eq.includes("van")) equipmentBonus = 10;

  // Lane fit bonus (0–10)
  let laneBonus = 5;
  if (load.origin_state && load.dest_state) laneBonus = 10;

  const raw = rpmScore - deadheadPenalty + urgencyBonus + equipmentBonus + laneBonus;

  // Additional "hard floor" logic: if rpm < minRPM, cap score
  let finalScore = clamp(raw, 0, 100);
  if (rpm > 0 && rpm < minRPM) finalScore = Math.min(finalScore, 35);

  return finalScore;
}
