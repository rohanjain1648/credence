/** Relayer allows 500 points/hour and 60/minute per account; the app keeps headroom for recalls. */
export const POINTS_PER_REMEMBER = 5;
export const HOURLY_POINTS = 400;
export const MINUTE_POINTS = 50;

export function pointsAvailable(sentAt: number[], now: number): number {
  const lastHour = sentAt.filter((t) => t > now - 3_600_000).length;
  const lastMinute = sentAt.filter((t) => t > now - 60_000).length;
  return Math.max(0, Math.min(HOURLY_POINTS - POINTS_PER_REMEMBER * lastHour, MINUTE_POINTS - POINTS_PER_REMEMBER * lastMinute));
}
