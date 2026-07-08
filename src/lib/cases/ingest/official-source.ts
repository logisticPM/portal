// Official-source full-text backfill (spec 2026-07-07 rev). v1: www.bccourts.ca HTML.
// Deterministic, VERBATIM HTML→text (no LLM) so downstream summary/figure
// verbatim-verification stays valid; only allow-listed open hosts are fetched
// (CanLII and the PDF/Lexum hosts are excluded in v1).
const OPEN_HOSTS = ["www.bccourts.ca"]; // v1; v2 adds the Lexum PDF hosts

export function isOpenSource(url: string): boolean {
  try { return OPEN_HOSTS.includes(new URL(url).host); } catch { return false; }
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

// Deterministic HTML → plain text with paragraph breaks. Removes script/style/head
// and nav/header/footer blocks, turns block-level closes into paragraph breaks,
// strips remaining tags, decodes common entities, collapses intra-line whitespace.
// VERBATIM: only markup/whitespace is removed — word characters are never altered.
export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<(script|style|head|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote)>/gi, "\n\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)));
  for (const [k, v] of Object.entries(ENTITIES)) s = s.split(k).join(v);
  const paras = s.split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return paras.join("\n\n");
}

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const MIN_TEXT = 200; // shorter than this = a shell/error page → skip (never store garbage)

// Fetch an official page (browser UA — some official sites 403 non-browser agents)
// and extract verbatim text. Returns "" on a non-open host, network failure, or an
// implausibly short extraction. `get` is injectable for offline tests.
export async function fetchOfficialText(url: string, get?: (u: string) => Promise<string>): Promise<string> {
  if (!isOpenSource(url)) return "";
  const doGet = get ?? (async (u: string) => {
    const res = await fetch(u, { headers: { "User-Agent": BROWSER_UA } });
    return res.ok ? res.text() : "";
  });
  try {
    const text = htmlToText(await doGet(url));
    return text.length >= MIN_TEXT ? text : "";
  } catch { return ""; }
}
