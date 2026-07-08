// Official-source full-text backfill (spec 2026-07-07 rev). v1: www.bccourts.ca HTML.
// v2 adds decisions.scc-csc.ca (SCC/Lexum PDFs). Deterministic, VERBATIM HTML→text
// (no LLM) so downstream summary/figure verbatim-verification stays valid; only
// allow-listed open hosts are fetched (CanLII remains excluded).
import pdfParse from "pdf-parse/lib/pdf-parse.js";

export const OPEN_HOSTS = ["www.bccourts.ca", "decisions.scc-csc.ca"];

// robots.txt (User-agent: *) disallows exactly these two documents — honor it even
// though they are /icm/ (not /scc-csc/) and won't appear in our SCC set.
const ROBOTS_DENY = [
  "/icm/icm/en/item/120620/", "/icm/icm/en/120620/1/document.do",
  "/icm/icm/en/item/111322/", "/icm/icm/en/111322/1/document.do",
];

export function isOpenSource(url: string): boolean {
  try { return OPEN_HOSTS.includes(new URL(url).host); } catch { return false; }
}

// SCC (Lexum) stores judgments as PDFs at …/<id>/1/document.do, but the corpus may
// hold the viewer URL …/item/<id>/index.do. Normalize to the direct-PDF form so we
// fetch the PDF, not the JS-viewer shell. Non-SCC and already-document.do URLs pass
// through unchanged.
export function toDocumentUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.host !== "decisions.scc-csc.ca") return url;
    const m = u.pathname.match(/^(.*)\/item\/(\d+)\/index\.do\/?$/);
    if (!m) return url; // already document.do (or an unrecognized shape) → leave as-is
    u.pathname = `${m[1]}/${m[2]}/1/document.do`;
    return u.toString();
  } catch { return url; }
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

// Common PDF ligature glyphs → their ASCII letters (verbatim: same letters, one glyph).
const LIGATURES: Record<string, string> = {
  "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "ft", "ﬆ": "st",
};
// A running header/footer line we deterministically drop for SCC PDFs.
const RUNNING_HEADER_RE = /^\s*SUPREME COURT OF CANADA\s*$/;

// Deterministic, VERBATIM cleanup of raw pdf-parse text. Only removes artifacts
// (running headers, page-number lines, line-break hyphenation) and normalizes ligature
// glyphs to the identical ASCII letters — never alters or invents word content.
export function cleanupPdfText(raw: string): string {
  let s = raw.replace(/\r\n?/g, "\n");
  for (const [k, v] of Object.entries(LIGATURES)) s = s.split(k).join(v);
  // Line-break at a hyphen: remove only the NEWLINE, keep the hyphen. We cannot
  // deterministically tell a soft (line-wrap) hyphen from a real compound hyphen without
  // a lexicon, so we never delete the hyphen — a retained soft-hyphen ("judg-ment") is a
  // verbatim-faithful artifact (lost recall), whereas deleting a real one fabricates a
  // non-word ("selfdetermination"). Integrity over prettiness.
  s = s.replace(/([A-Za-z])-\n([A-Za-z])/g, "$1-$2");
  const lines = s.split("\n").filter((ln) => {
    const t = ln.trim();
    if (RUNNING_HEADER_RE.test(t)) return false; // running header
    if (/^\d{1,3}$/.test(t)) return false; // page-number-only line — 1–3 digits so a 4-digit year ("...Act, 1982") on its own line is NOT dropped; a rare standalone 1–3 digit content number may be lost (safe-fail = recall, verified acceptable in the ops fidelity gate)
    return true;
  });
  // Re-join, collapse intra-line whitespace, paragraph-join on blank lines.
  const paras = lines.join("\n").split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return paras.join("\n\n");
}

// Verbatim PDF → text. `parse` is injectable for offline tests. SCC PDFs are
// digitally generated (text, not scanned), so pdf-parse yields clean text.
export async function pdfToText(buf: Buffer, parse: (b: Buffer) => Promise<{ text: string }> = pdfParse): Promise<string> {
  try {
    const { text } = await parse(buf);
    return cleanupPdfText(text || "");
  } catch { return ""; }
}

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const MIN_TEXT = 200; // shorter than this = a shell/error page → skip (never store garbage)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Fetched = { buf: Buffer; contentType: string };

// Decode HTML bytes using the declared charset (Content-Type → <meta charset> → default
// windows-1252, which fixes bccourts' legacy-encoded apostrophes/accents).
function decodeHtml(buf: Buffer, contentType: string): string {
  const header = /charset=([^;\s]+)/i.exec(contentType)?.[1];
  const meta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.toString("latin1").slice(0, 2048))?.[1];
  let cs = (header ?? meta ?? "windows-1252").toLowerCase();
  if (cs === "iso-8859-1" || cs === "latin1") cs = "windows-1252";
  try { return new TextDecoder(cs).decode(buf); }
  catch { return new TextDecoder("windows-1252").decode(buf); }
}

// Default fetch: browser UA, retry-once on non-OK (official sites throttle bursts),
// returns raw bytes + content-type.
async function defaultFetch(u: string): Promise<Fetched> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(u, { headers: { "User-Agent": BROWSER_UA } });
    if (res.ok) return { buf: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "" };
    if (attempt === 0) await sleep(1500);
  }
  return { buf: Buffer.alloc(0), contentType: "" };
}

// Fetch an official page and extract verbatim text. Returns "" on a robots-denied URL, a
// non-open host, a network failure, or an implausibly short extraction. `get` is
// injectable for offline tests.
export async function fetchOfficialText(url: string, get: (u: string) => Promise<Fetched> = defaultFetch): Promise<string> {
  if (ROBOTS_DENY.some((d) => url.includes(d))) return "";
  if (!isOpenSource(url)) return "";
  const target = toDocumentUrl(url);
  try {
    const { buf, contentType } = await get(target);
    if (buf.length === 0) return "";
    const isPdf = /application\/pdf/i.test(contentType) || target.endsWith("/document.do");
    const text = isPdf ? await pdfToText(buf) : htmlToText(decodeHtml(buf, contentType));
    return text.length >= MIN_TEXT ? text : "";
  } catch { return ""; }
}
