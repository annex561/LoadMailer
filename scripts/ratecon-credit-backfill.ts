/**
 * One-time cleanup for the OpenAI credit outage (2026-07-06 to 2026-10-24).
 * See docs/FIX-LEDGER.md, "RateCon parses failing with OpenAI 429 for 3.5 months".
 *
 * READ-ONLY by default. Lists one line per distinct email attachment whose parse
 * failed with an OpenAI 429 credit/quota error, and whether its load already
 * exists. PDFs come from Cloudinary and their text is read locally: no OpenAI.
 *
 *   PGOPTIONS='-c default_transaction_read_only=on' DATABASE_URL=<public url> \
 *     npx tsx scripts/ratecon-credit-backfill.ts --out=backlog.csv
 *
 * Writes, only after Annex approves:
 *   --collapse                     every duplicate credit-error row -> merged_into_other (status only, no deletes)
 *   --apply --ids=a,b,c --max=N    re-parse those keeper intakes once each, auto-dispatch OFF (calls OpenAI)
 *
 * Every write re-checks status='in_review' AND parsed_json IS NULL, so a second run changes nothing.
 */
import { createHash } from "crypto";
import { writeFileSync } from "fs";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { extractPdfText } from "../server/ratecon-confidence-parser";
import { isOpenAiCreditError } from "../server/openai-errors";

export type CreditRow = {
  id: string;
  source_email_message_id: string | null;
  source_filename: string | null;
  pdf_path: string | null;
  created_at: string | Date;
  parse_error: string | null;
};
export type Group = { keep: CreditRow; dupes: CreditRow[] };

// One group per email attachment. Rows arrive oldest first, so the first row is
// the keeper and the rest are the duplicate enqueues.
export function groupByAttachment(rows: CreditRow[]): Group[] {
  const groups = new Map<string, CreditRow[]>();
  for (const r of rows) {
    const key = `${r.source_email_message_id}\u0000${r.source_filename}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  return [...groups.values()].map((rs) => ({ keep: rs[0], dupes: rs.slice(1) }));
}

// Tokens that could be a load, PO or order number: at least 5 digits.
export function refsIn(text: string): string[] {
  const out = new Set<string>();
  for (const tok of text.split(/[^A-Za-z0-9-]+/)) {
    for (const t of [tok, ...tok.split("-")]) {
      if ((t.match(/\d/g)?.length ?? 0) >= 5) out.add(t.toUpperCase());
    }
  }
  return [...out];
}

export function classify(filename: string, text: string): "driver-sheet" | "ratecon" | "agreement" | "bol" | "other" {
  if (/driver-sheet/i.test(filename)) return "driver-sheet";
  // Broker-carrier agreements quote "rate confirmation" in their terms, so the filename decides first.
  if (/agreement|\bBCA\b|addendum/i.test(filename)) return "agreement";
  if (/\bBOL\b|receiver signature|\bPOD\b/i.test(filename)) return "bol";
  // Some brokers print letter-spaced text ("R a t e C o n f i r m"), so match with whitespace removed.
  const squashed = `${filename} ${text}`.replace(/\s+/g, "");
  const ratecon = /ratecon|rateconfirm|loadconfirm|carrierconfirm|tender/i.test(squashed) || /\bRC\b/.test(filename);
  if (!ratecon && /agreement|addendum|broker.carrier|carrier.broker/i.test(text + " " + filename)) return "agreement";
  if (ratecon || (/\brate\b|line ?haul|carrier pay/i.test(text) && /pick ?up|shipper|origin/i.test(text))) return "ratecon";
  return "other";
}

const rowsOf = (r: any) => (r as any).rows ?? r;

async function loadCreditRows(): Promise<CreditRow[]> {
  const r = await db.execute(sql`
    SELECT id, source_email_message_id, source_filename, pdf_path, created_at, parse_error
    FROM ratecon_intake
    WHERE status = 'in_review' AND parsed_json IS NULL AND parse_error LIKE '429%'
    ORDER BY created_at ASC, id ASC
  `);
  return rowsOf(r).filter((x: CreditRow) => isOpenAiCreditError(x.parse_error));
}

async function download(url: string | null): Promise<Buffer | null> {
  if (!url) return null;
  const res = await fetch(url);
  return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
}

type Inspected = Group & {
  sha: string | null;
  refs: string[];
  kind: string;
  ref: string;
  header: string;
  existingLoad: string;
  matchesIntake: string;
  samePdfAs: string;
};

async function inspect(groups: Group[]): Promise<Inspected[]> {
  const loadNums = new Set<string>(
    rowsOf(await db.execute(sql`SELECT UPPER(load_number) AS n FROM loads WHERE load_number IS NOT NULL`)).map((x: any) => x.n),
  );
  const intakeNums = new Map<string, string>(
    rowsOf(
      await db.execute(sql`
        SELECT UPPER(parsed_json->'loadNumber'->>'value') AS n, MIN(id) AS id FROM ratecon_intake
        WHERE parsed_json->'loadNumber'->>'value' IS NOT NULL AND status NOT IN ('rejected', 'merged_into_other')
        GROUP BY 1
      `),
    ).map((x: any) => [x.n, x.id]),
  );

  const out: Inspected[] = [];
  for (let i = 0; i < groups.length; i += 8) {
    const batch = await Promise.all(
      groups.slice(i, i + 8).map(async (g) => {
        const pdf = await download(g.keep.pdf_path);
        const text = pdf ? await extractPdfText(pdf) : "";
        const filename = g.keep.source_filename ?? "";
        const refs = [...refsIn(filename), ...refsIn(text)];
        const label = text.match(/(?:load|order|po|pro|confirmation|tender|ref(?:erence)?)\s*(?:#|no\.?|number)?\s*[:#]?\s*([A-Z0-9-]*\d{4,}[A-Z0-9-]*)/i);
        return {
          ...g,
          sha: pdf ? createHash("sha256").update(pdf).digest("hex") : null,
          kind: pdf ? classify(filename, text) : "pdf-missing",
          ref: refsIn(filename)[0] ?? label?.[1] ?? "",
          header: text.replace(/\s+/g, " ").slice(0, 70),
          refs,
          existingLoad: "",
          matchesIntake: "",
          samePdfAs: "",
        };
      }),
    );
    out.push(...batch);
  }
  // A number printed on many different PDFs is ours (LAMP's MC 1725755, a dispatch
  // phone), not a load number. Junk loads and intakes carry those as load numbers.
  const seenIn = new Map<string, Set<string>>();
  for (const x of out) for (const r of x.refs) seenIn.set(r, (seenIn.get(r) ?? new Set()).add(x.sha ?? x.keep.id));
  for (const x of out) {
    const refs = x.refs.filter((r) => seenIn.get(r)!.size <= 4 && !/^[2-9]\d{9}$/.test(r)); // 10-digit = phone
    x.existingLoad = refs.find((r) => loadNums.has(r)) ?? "";
    x.matchesIntake = refs.map((r) => intakeNums.get(r)).find(Boolean) ?? "";
  }
  const firstBySha = new Map<string, string>();
  for (const x of out) {
    if (!x.sha) continue;
    if (firstBySha.has(x.sha)) x.samePdfAs = firstBySha.get(x.sha)!;
    else firstBySha.set(x.sha, x.keep.id);
  }
  return out;
}

export function shouldReparse(x: Pick<Inspected, "kind" | "existingLoad" | "matchesIntake" | "samePdfAs">): boolean {
  return (x.kind === "ratecon" || x.kind === "driver-sheet") && !x.existingLoad && !x.matchesIntake && !x.samePdfAs;
}

async function collapse(ids: string[], reason: string): Promise<number> {
  if (ids.length === 0) return 0;
  const r = await db.execute(sql`
    UPDATE ratecon_intake
    SET status = 'merged_into_other',
        review_reason = COALESCE(review_reason, '') || ' | ' || ${reason}::text,
        updated_at = NOW()
    WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      AND status = 'in_review' AND parsed_json IS NULL
    RETURNING id
  `);
  return rowsOf(r).length;
}

const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

async function main() {
  const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  const flag = (name: string) => process.argv.includes(`--${name}`);
  const groups = groupByAttachment(await loadCreditRows());
  const dupeCount = groups.reduce((s, g) => s + g.dupes.length, 0);
  console.log(`${groups.length + dupeCount} credit-error rows, ${groups.length} distinct email attachments, ${dupeCount} duplicate rows.`);

  if (flag("apply")) {
    const max = Number(arg("max"));
    if (!Number.isInteger(max) || max < 1 || max > 300) throw new Error("--apply needs --max=N (1-300)");
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
    const want = new Set((arg("ids") ?? "").split(",").filter(Boolean));
    const todo = groups.filter((g) => want.has(g.keep.id));
    console.log(`${todo.length} of ${want.size} ids are still pending keepers. Re-parsing at most ${max}, auto-dispatch OFF.`);
    const { parseIntake } = await import("../server/ratecon-intake-service");
    let failsInRow = 0;
    for (const g of todo.slice(0, max)) {
      const pdf = await download(g.keep.pdf_path);
      if (!pdf) {
        console.log(`SKIP ${g.keep.id}: PDF not downloadable`);
        continue;
      }
      const res = await parseIntake(g.keep.id, pdf, { autoDispatch: false });
      if (!res.ok) {
        console.log(`FAIL ${g.keep.id}: ${res.error}`);
        if (isOpenAiCreditError(res.error)) {
          console.error("OpenAI is still out of credits. Stopping.");
          break;
        }
        if (++failsInRow >= 3) {
          console.error("3 failures in a row. Stopping.");
          break;
        }
        continue;
      }
      failsInRow = 0;
      const n = await collapse(g.dupes.map((d) => d.id), `Duplicate enqueue of intake ${g.keep.id} (credit-outage backfill)`);
      console.log(`OK   ${g.keep.id} -> ${res.status}${res.mergedInto ? ` (merged into ${res.mergedInto})` : ""}, ${n} duplicate row(s) collapsed`);
    }
    process.exit(0);
  }

  const inspected = await inspect(groups);

  if (flag("collapse")) {
    let n = 0;
    for (const x of inspected) {
      n += await collapse(x.dupes.map((d) => d.id), `Duplicate enqueue of intake ${x.keep.id} (credit-outage backfill)`);
      if (x.samePdfAs) n += await collapse([x.keep.id], `Same PDF as intake ${x.samePdfAs} (credit-outage backfill)`);
    }
    console.log(`Collapsed ${n} row(s) to merged_into_other.`);
    process.exit(0);
  }

  const header = "n,keep_id,received,filename,kind,ref,dupe_rows,same_pdf_as,existing_load,matches_intake,reparse,header";
  const lines = inspected.map((x, i) =>
    [
      i + 1,
      x.keep.id,
      new Date(x.keep.created_at).toISOString().slice(0, 10),
      x.keep.source_filename,
      x.kind,
      x.ref,
      x.dupes.length,
      x.samePdfAs,
      x.existingLoad,
      x.matchesIntake,
      shouldReparse(x) ? "yes" : "no",
      x.header,
    ]
      .map(csv)
      .join(","),
  );
  const out = arg("out") ?? "ratecon-credit-backlog.csv";
  writeFileSync(out, [header, ...lines].join("\n") + "\n");
  const count = (k: string) => inspected.filter((x) => x.kind === k).length;
  console.log(
    `kinds: ratecon ${count("ratecon")}, driver-sheet ${count("driver-sheet")}, agreement ${count("agreement")}, other ${count("other")}, pdf-missing ${count("pdf-missing")}`,
  );
  console.log(`same PDF as another email: ${inspected.filter((x) => x.samePdfAs).length}`);
  console.log(`load already in loads: ${inspected.filter((x) => x.existingLoad).length}; matches an earlier intake: ${inspected.filter((x) => x.matchesIntake).length}`);
  console.log(`recommended re-parse: ${inspected.filter(shouldReparse).length}. Wrote ${out}`);
  process.exit(0);
}

if (process.argv[1]?.endsWith("ratecon-credit-backfill.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
