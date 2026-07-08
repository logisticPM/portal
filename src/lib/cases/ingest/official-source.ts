// Official-source full-text backfill (spec 2026-07-07 rev). v1: www.bccourts.ca HTML.
// v2 adds decisions.scc-csc.ca (SCC/Lexum PDFs). Deterministic, VERBATIM HTML→text
// (no LLM) so downstream summary/figure verbatim-verification stays valid; only
// allow-listed open hosts are fetched (CanLII remains excluded).
export const OPEN_HOSTS = ["www.bccourts.ca", "decisions.scc-csc.ca"];

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
    const m = u.pathname.match(/^(.*)\/item\/(\d+)\/index\.do$/);
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

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const MIN_TEXT = 200; // shorter than this = a shell/error page → skip (never store garbage)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fetch an official page (browser UA — some official sites 403 non-browser agents)
// and extract verbatim text. Returns "" on a non-open host, network failure, or an
// implausibly short extraction. `get` is injectable for offline tests.
export async function fetchOfficialText(url: string, get?: (u: string) => Promise<string>): Promise<string> {
  if (!isOpenSource(url)) return "";
  const doGet = get ?? (async (u: string) => {
    // Retry once on a non-OK response — official sites rate-limit bursts (429/403);
    // a short backoff clears a transient throttle. The caller also paces requests.
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(u, { headers: { "User-Agent": BROWSER_UA } });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        // Decode with the declared charset (Content-Type, else a <meta charset>),
        // default windows-1252 — bccourts serves legacy-encoded HTML, and UTF-8-
        // decoding it mangles apostrophes/accents (e.g. nation names like "Tsilhqot'in").
        const ct = res.headers.get("content-type") ?? "";
        const header = /charset=([^;\s]+)/i.exec(ct)?.[1];
        const metaHtml = buf.toString("latin1").slice(0, 2048);
        const meta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(metaHtml)?.[1];
        let cs = (header ?? meta ?? "windows-1252").toLowerCase();
        if (cs === "iso-8859-1" || cs === "latin1") cs = "windows-1252"; // superset, fixes smart quotes
        try { return new TextDecoder(cs as string).decode(buf); }
        catch { return new TextDecoder("windows-1252").decode(buf); }
      }
      if (attempt === 0) await sleep(1500); // transient throttle → back off once
    }
    return "";
  });
  try {
    const text = htmlToText(await doGet(url));
    return text.length >= MIN_TEXT ? text : "";
  } catch { return ""; }
}
