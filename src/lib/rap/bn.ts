// Canada Revenue Agency Business Number. Identity is the 9-digit ROOT; the
// optional program account (e.g. RC0001) denotes a program of the SAME business.
// The 9th digit is a Luhn (mod-10) check digit — a cheap pre-filter before any
// registry call; the authoritative check is registry verifyBN().
const PROGRAMS = new Set(["RC", "RT", "RP", "RM", "RR", "RZ"]);

function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

export function isValidBN(raw: string): { bn9: string } | null {
  if (!raw) return null;
  const compact = raw.toUpperCase().replace(/\s+/g, "");
  const m = compact.match(/^(\d{9})([A-Z]{2}\d{4})?$/);
  if (!m) return null;
  if (m[2] && !PROGRAMS.has(m[2].slice(0, 2))) return null;
  if (!luhnValid(m[1])) return null;
  return { bn9: m[1] };
}
