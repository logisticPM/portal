// The crawler's identity on the wire. ONE definition, so there is one string to audit.
//
// This replaces a browser user-agent that both official-source.ts and robots.ts had
// adopted independently, with the rationale "some official hosts 403 a non-browser UA".
// Probed 2026-08-03 against decisions.scc-csc.ca: a truthful UA returns 200 for both
// robots.txt and a judgment PDF, so the premise does not hold there.
//
// Presenting an automated crawler as Chrome to a court website that has deployed bot
// detection is not something this project does. It is also counterproductive: an
// identified crawler can be allowlisted and can appeal a block; a browser lookalike can
// only be rate-limited as anonymous load. If a host refuses this UA, that is a finding to
// report — see cases-probe-hosts.ts — not something to route around.
export const CRAWLER_UA =
  "IndigenomicsLegalHub/1.0 (Indigenous economic-justice research corpus; +https://github.com/logisticPM/portal)";

// The token robots.txt groups are matched against. Kept distinct from the wire UA because
// robots-parser matches on a bare product token, not the full string.
export const CRAWLER_TOKEN = "IndigenomicsLegalHub";
