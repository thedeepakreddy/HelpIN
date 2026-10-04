import i18n from '../i18n';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "Just now", "12 min ago", "2 h ago", "Yesterday", "3 d ago", "12 Oct". */
export function relativeTime(iso: string, now = Date.now()): string {
  const t = i18n.t.bind(i18n);
  const diff = Math.max(0, now - new Date(iso).getTime());
  if (diff < MIN) return t('time.justNow');
  if (diff < HOUR) return t('time.minutesAgo', { count: Math.floor(diff / MIN) });
  if (diff < DAY) return t('time.hoursAgo', { count: Math.floor(diff / HOUR) });
  if (diff < 2 * DAY) return t('time.yesterday');
  if (diff < 7 * DAY) return t('time.daysAgo', { count: Math.floor(diff / DAY) });
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** Whole hours left until a deadline (never negative). */
export function hoursLeft(iso: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / HOUR));
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
