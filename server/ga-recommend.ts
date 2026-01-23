import { gaDb } from "./ga-db";

type Truck = {
  id: string;
  label?: string;
  home_zip?: string;
  home_city?: string;
  home_state?: string;
};

type Driver = {
  id: string;
  name?: string;
  phone?: string;
};

type Gate = {
  status: "GREEN" | "YELLOW" | "RED";
  risk?: number;
  reasons?: string[];
};

async function safeJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

function gateWeight(g: Gate): number {
  if (g.status === "GREEN") return 1000;
  if (g.status === "YELLOW") return 500;
  return -100000;
}

function riskPenalty(g: Gate): number {
  const r = typeof g.risk === "number" ? g.risk : 0;
  return r;
}

export async function recommendForLoad(load: any) {
  const base =
    process.env.INTERNAL_API_BASE_URL ||
    process.env.API_BASE_URL ||
    "http://localhost:5000";

  const trucksPayload =
    (await safeJson(`${base}/api/fleet/trucks`)) ||
    (await safeJson(`${base}/api/fleet/truck`)) ||
    (await safeJson(`${base}/api/trucks`));

  const driversPayload =
    (await safeJson(`${base}/api/fleet/drivers`)) ||
    (await safeJson(`${base}/api/drivers`));

  const trucks: Truck[] = (trucksPayload?.trucks || trucksPayload || []).map((t: any) => ({
    id: String(t.id ?? t.truck_id ?? ""),
    label: t.label ?? t.unit_number ?? t.number ?? t.name,
    home_zip: t.home_zip ?? t.zip ?? t.base_zip,
    home_city: t.home_city ?? t.city ?? t.base_city,
    home_state: t.home_state ?? t.state ?? t.base_state,
  })).filter((t: Truck) => t.id);

  const drivers: Driver[] = (driversPayload?.drivers || driversPayload || []).map((d: any) => ({
    id: String(d.id ?? d.driver_id ?? ""),
    name: d.name ?? d.full_name,
    phone: d.phone ?? d.mobile,
  })).filter((d: Driver) => d.id);

  const gateChecks = await Promise.all(
    trucks.map(async (t) => {
      const gate = (await safeJson(`${base}/api/fleet/trucks/${encodeURIComponent(t.id)}/dispatch-gate`)) as Gate | null;
      return { truck: t, gate: gate ?? { status: "YELLOW" as const, risk: 0, reasons: ["Gate unavailable"] } };
    })
  );

  const scoredTrucks = gateChecks
    .map(({ truck, gate }) => {
      const score = gateWeight(gate) - riskPenalty(gate);
      const reasons: string[] = [];
      reasons.push(`Dispatch: ${gate.status}`);
      if (typeof gate.risk === "number") reasons.push(`Risk: ${gate.risk}`);
      if (gate.status === "YELLOW") reasons.push("May require manager override");
      if (gate.status === "RED") reasons.push("Excluded unless override");
      return { truck, gate, score, reasons };
    })
    .filter((x) => x.gate.status !== "RED")
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const topDrivers = drivers.slice(0, 5);

  return {
    ok: true,
    load: { id: load?.id, origin: `${load?.origin_city ?? ""}, ${load?.origin_state ?? ""}`, dest: `${load?.dest_city ?? ""}, ${load?.dest_state ?? ""}` },
    recommended_trucks: scoredTrucks.map((x) => ({
      id: x.truck.id,
      label: x.truck.label ?? x.truck.id,
      gate: x.gate,
      score: x.score,
      reasons: x.reasons,
    })),
    recommended_drivers: topDrivers.map((d) => ({
      id: d.id,
      name: d.name ?? d.id,
      phone: d.phone,
    })),
  };
}
