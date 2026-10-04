/**
 * The one source of "now" for business logic, so tests can time-travel (response rule,
 * lifetimes, cooldowns) without touching the system clock.
 */
let offsetMs = 0;
let frozen: number | null = null;

export const now = (): Date => new Date((frozen ?? Date.now()) + offsetMs);

export const clock = {
  advance(ms: number) {
    offsetMs += ms;
  },
  freeze(at: Date) {
    frozen = at.getTime();
    offsetMs = 0;
  },
  reset() {
    frozen = null;
    offsetMs = 0;
  },
};

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
