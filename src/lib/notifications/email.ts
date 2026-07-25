// SES v2 sender. Injectable client so tests never hit AWS. From/region come
// from env (set per stage). Throws on send failure — runDigest records that.
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

export interface Emailer {
  send(msg: { to: string; subject: string; html: string; text: string }): Promise<void>;
}

export function makeSesEmailer(client?: SESv2Client): Emailer {
  const ses = client ?? new SESv2Client({ region: process.env.AWS_REGION ?? "us-east-1" });
  const from = process.env.DIGEST_SENDER ?? "";
  return {
    async send({ to, subject, html, text }) {
      await ses.send(
        new SendEmailCommand({
          FromEmailAddress: from,
          Destination: { ToAddresses: [to] },
          Content: { Simple: { Subject: { Data: subject }, Body: { Html: { Data: html }, Text: { Data: text } } } },
        }),
      );
    },
  };
}
