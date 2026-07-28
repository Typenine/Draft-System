/**
 * Calculate the time remaining until a target date
 * @param targetDate The date to count down to
 * @returns Object containing days, hours, minutes, seconds remaining
 */
export function getTimeRemaining(targetDate: Date | string | number): {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  total: number;
} {
  const target = targetDate instanceof Date ? targetDate : new Date(targetDate);
  const total = target.getTime() - new Date().getTime();
  const seconds = Math.floor((total / 1000) % 60);
  const minutes = Math.floor((total / 1000 / 60) % 60);
  const hours = Math.floor((total / (1000 * 60 * 60)) % 24);
  const days = Math.floor(total / (1000 * 60 * 60 * 24));
  
  return {
    total,
    days,
    hours,
    minutes,
    seconds
  };
}
