// Per-host robots.txt compliance for the official-source fetcher. Fetches and parses each
// host's robots.txt (robots-parser, RFC 9309), memoized per host, and answers allows(url).
// Policy: 2xx → obey; 404 → allow (no robots = no restrictions); 403/5xx/error → skip
// (conservative). Only ops scripts import this — never the Web/BriefGen Lambda bundle.
import robotsParser from "robots-parser";

// We present a browser UA on the wire (some official hosts 403 a non-browser UA) but match
// robots groups as an unnamed crawler → falls through to the catch-all `User-agent: *` group.
const ROBOTS_BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
export const ROBOTS_UA = "IndigenomicsLegalHub";

export type RobotsFetchResult = { status: number; body: string };
export type RobotsFetcher = (robotsUrl: string) => Promise<RobotsFetchResult>;

// Default robots.txt fetch: browser UA, single attempt, never throws (network error → status 0).
export const defaultRobotsFetch: RobotsFetcher = async (robotsUrl) => {
  try {
    const res = await fetch(robotsUrl, { headers: { "User-Agent": ROBOTS_BROWSER_UA } });
    return { status: res.status, body: res.ok ? await res.text() : "" };
  } catch {
    return { status: 0, body: "" };
  }
};

// A robots gate with an internal per-host cache. Reuse one instance across a whole
// backfill/audit run so each host's robots.txt is fetched at most once.
export function makeRobotsGate(fetchRobots: RobotsFetcher = defaultRobotsFetch): {
  allows: (url: string) => Promise<boolean>;
} {
  const cache = new Map<string, Promise<(url: string) => boolean>>();

  function matcherFor(host: string): Promise<(url: string) => boolean> {
    let m = cache.get(host);
    if (!m) { m = build(host); cache.set(host, m); }
    return m;
  }

  async function build(host: string): Promise<(url: string) => boolean> {
    const robotsUrl = `https://${host}/robots.txt`;
    const { status, body } = await fetchRobots(robotsUrl);
    if (status >= 200 && status < 300) {
      const robots = robotsParser(robotsUrl, body);
      // robots-parser returns undefined when no rule applies to the URL → treat as allowed.
      return (u: string) => robots.isAllowed(u, ROBOTS_UA) ?? true;
    }
    if (status === 404) return () => true;   // genuinely no robots.txt → no restrictions
    return () => false;                       // 403 / 5xx / network error (0) → skip (conservative)
  }

  async function allows(url: string): Promise<boolean> {
    let host: string;
    try { host = new URL(url).host; } catch { return false; }
    return (await matcherFor(host))(url);
  }

  return { allows };
}

// Process-wide singleton used by fetchOfficialText's default path.
export const defaultRobotsGate = makeRobotsGate();
