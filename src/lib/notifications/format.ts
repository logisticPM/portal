// Deterministic render of an OverdueDigest to an email (subject + html + text).
// No template engine; plain string building so it is trivially testable.
import type { OverdueDigest } from "./types";

export function renderDigestEmail(d: OverdueDigest): { subject: string; html: string; text: string } {
  const onTrack = d.totals.overdue === 0 && d.totals.atRisk === 0;
  const subject = onTrack
    ? `RAP Index: all milestones on track (week ${d.isoWeek})`
    : `RAP Index: ${d.totals.overdue} overdue, ${d.totals.atRisk} at-risk across ${d.totals.orgs} organization${d.totals.orgs === 1 ? "" : "s"} (week ${d.isoWeek})`;

  if (onTrack) {
    const body = `No overdue or at-risk RAP milestones this week. The network is on pace.`;
    return {
      subject,
      text: `${subject}\n\n${body}\n`,
      html: `<h2>${escapeHtml(subject)}</h2><p>${escapeHtml(body)}</p>`,
    };
  }

  const textLines: string[] = [subject, ""];
  const htmlParts: string[] = [`<h2>${escapeHtml(subject)}</h2>`];
  for (const g of d.groups) {
    const head = `${g.orgName} — ${g.overdue} overdue, ${g.atRisk} at-risk`;
    textLines.push(head);
    htmlParts.push(`<h3>${escapeHtml(head)}</h3><ul>`);
    for (const it of g.items) {
      const line = `  • [${it.kind === "overdue" ? "OVERDUE" : "AT RISK"}] ${it.title} (target ${it.targetYear}) — ${it.reason}`;
      textLines.push(line);
      htmlParts.push(`<li><strong>${it.kind === "overdue" ? "Overdue" : "At risk"}</strong>: ${escapeHtml(it.title)} (target ${it.targetYear}) — ${escapeHtml(it.reason)}</li>`);
    }
    textLines.push("");
    htmlParts.push(`</ul>`);
  }

  return { subject, text: textLines.join("\n") + "\n", html: htmlParts.join("") };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
