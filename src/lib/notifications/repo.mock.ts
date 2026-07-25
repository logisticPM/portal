import type { NotificationRecord, NotificationsRepo } from "./types";

let store = new Map<string, NotificationRecord>(); // key = isoWeek

// newest-first; ISO-week strings sort lexically (year-first, zero-padded week)
const byWeekDesc = (a: NotificationRecord, b: NotificationRecord) => b.isoWeek.localeCompare(a.isoWeek);

export const mockNotificationsRepo: NotificationsRepo = {
  async put(rec) {
    store.set(rec.isoWeek, rec);
    return rec;
  },
  async latest(n) {
    return [...store.values()].sort(byWeekDesc).slice(0, n);
  },
  async getByWeek(isoWeek) {
    return store.get(isoWeek) ?? null;
  },
};

// test-only reset
export function _resetMockNotifications() {
  store = new Map();
}
