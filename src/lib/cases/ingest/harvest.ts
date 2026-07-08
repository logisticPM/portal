// Live A2AJ harvest. /search has size<=50 and no offset, so we page by date windows.
// Raw responses are cached to disk so re-runs are free and offline. NOT unit-tested
// beyond the pure `dateWindows` helper (network is exercised by cases:ingest).
import { promises as fs } from "node:fs";
import path from "node:path";
import { fetchA2aj, type A2ajRecord } from "./a2aj";

const CACHE_DIR = path.join(process.cwd(), "scripts", ".cache", "a2aj");
const SLEEP_MS = 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function dateWindows(from: string, to: string, years: number): [string, string][] {
  const out: [string, string][] = [];
  let y = new Date(from).getUTCFullYear();
  const endY = new Date(to).getUTCFullYear();
  while (y <= endY) {
    const wEnd = Math.min(y + years - 1, endY);
    out.push([`${y}-01-01`, `${wEnd}-12-31`]);
    y = wEnd + 1;
  }
  return out;
}

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const file = path.join(CACHE_DIR, key.replace(/[^a-z0-9]+/gi, "_") + ".json");
  try { return JSON.parse(await fs.readFile(file, "utf8")) as T; } catch { /* miss (incl. no dir) */ }
  const val = await fn();
  // Best-effort disk cache: a read-only FS (e.g. a Lambda's /var/task) must never be
  // fatal — mkdir/write inside try/catch, then proceed uncached.
  try { await fs.mkdir(CACHE_DIR, { recursive: true }); await fs.writeFile(file, JSON.stringify(val)); } catch { /* uncached */ }
  return val;
}

async function searchWindow(query: string, start: string, end: string): Promise<A2ajRecord[]> {
  return cached(`search_${query}_${start}_${end}`, async () => {
    const url = `https://api.a2aj.ca/search?query=${encodeURIComponent(query)}&search_type=full_text&size=50&start_date=${start}&end_date=${end}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: A2ajRecord[] };
    await sleep(SLEEP_MS);
    return data.results ?? [];
  });
}

export async function harvestQuery(query: string, from: string, to: string, years: number): Promise<A2ajRecord[]> {
  const out: A2ajRecord[] = [];
  for (const [s, e] of dateWindows(from, to, years)) out.push(...(await searchWindow(query, s, e)));
  return out;
}

export async function fetchCitation(citation: string): Promise<A2ajRecord | null> {
  return cached(`fetch_${citation}`, async () => {
    const r = await fetchA2aj(citation);
    await sleep(SLEEP_MS);
    return r;
  });
}

// Depth-1 forward snowball: pull the cases that cite each kept case.
export async function snowball(records: A2ajRecord[]): Promise<A2ajRecord[]> {
  const cites = new Set<string>();
  for (const r of records) for (const c of r.cases_citing_en ?? []) cites.add(c);
  const out: A2ajRecord[] = [];
  for (const c of cites) { const rec = await fetchCitation(c); if (rec) out.push(rec); }
  return out;
}
