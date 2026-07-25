// Shared orchestrator for BOTH triggers (weekly cron + institute button).
// Order: compute → persist (in-app never lost) → send → persist status.
import { commitmentsRepo, type CommitmentRepo } from "@/lib/commitments";
import { buildOverdueDigest } from "./digest";
import { renderDigestEmail } from "./format";
import { notificationsRepo } from "./index";
import { makeSesEmailer, type Emailer } from "./email";
import type { NotificationRecord, NotificationsRepo } from "./types";

export interface RunDeps {
  commitmentsRepo?: CommitmentRepo;
  notificationsRepo?: NotificationsRepo;
  emailer?: Emailer | null; // null → skip email; undefined → default SES when a recipient exists
  recipient?: string | null; // undefined → DIGEST_RECIPIENT env
  now?: Date;
}

export async function runDigest(deps: RunDeps = {}): Promise<NotificationRecord> {
  const commits = deps.commitmentsRepo ?? commitmentsRepo;
  const notify = deps.notificationsRepo ?? notificationsRepo;
  const now = deps.now ?? new Date();
  const recipient = deps.recipient !== undefined ? deps.recipient : (process.env.DIGEST_RECIPIENT ?? null);
  const emailer = deps.emailer !== undefined ? deps.emailer : (recipient ? makeSesEmailer() : null);

  const digest = buildOverdueDigest(await commits.listCommitments(), now);

  // persist FIRST so the in-app record survives any SES failure
  let rec: NotificationRecord = { ...digest, recipient, emailStatus: "skipped" };
  await notify.put(rec);

  if (recipient && emailer) {
    try {
      const { subject, html, text } = renderDigestEmail(digest);
      await emailer.send({ to: recipient, subject, html, text });
      rec = { ...rec, emailStatus: "sent" };
    } catch (e) {
      // Store the error NAME/code, not the message — raw SES errors (esp.
      // sandbox/verification failures) can embed the recipient address, a
      // latent PII leak into a persisted (and inbox-rendered) record.
      rec = { ...rec, emailStatus: "failed", emailError: e instanceof Error ? e.name : String(e) };
    }
    await notify.put(rec);
  }
  return rec;
}
