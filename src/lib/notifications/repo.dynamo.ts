import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../dynamo/client";
import { NOTIFICATIONS_TABLE, NOTIFY_PK, notificationKeys, toNotificationItem, itemToNotification } from "./notifications-table";
import type { NotificationRecord, NotificationsRepo } from "./types";

export const dynamoNotificationsRepo: NotificationsRepo = {
  async put(rec) {
    await ddbDoc.send(new PutCommand({ TableName: NOTIFICATIONS_TABLE, Item: toNotificationItem(rec) }));
    return rec;
  },
  async latest(n) {
    const r = await ddbDoc.send(
      new QueryCommand({
        TableName: NOTIFICATIONS_TABLE,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: { ":pk": NOTIFY_PK, ":sk": "DIGEST#" },
        ScanIndexForward: false, // newest ISO week first
        Limit: n,
      }),
    );
    return (r.Items ?? []).map(itemToNotification);
  },
  async getByWeek(isoWeek) {
    const r = await ddbDoc.send(new GetCommand({ TableName: NOTIFICATIONS_TABLE, Key: notificationKeys.digest(isoWeek) }));
    return r.Item ? itemToNotification(r.Item) : null;
  },
};
