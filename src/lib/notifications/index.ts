import type { NotificationsRepo } from "./types";
import { mockNotificationsRepo } from "./repo.mock";
import { dynamoNotificationsRepo } from "./repo.dynamo";

export const notificationsRepo: NotificationsRepo =
  process.env.REPO_IMPL === "dynamo" ? dynamoNotificationsRepo : mockNotificationsRepo;

export { buildOverdueDigest, isoWeekOf } from "./digest";
export { renderDigestEmail } from "./format";
export type { OverdueDigest, DigestOrgGroup, NotificationRecord, NotificationsRepo, EmailStatus } from "./types";
