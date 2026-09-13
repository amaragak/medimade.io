/**
 * Time-of-day greeting. Late night / pre-dawn hours are night, not morning
 * (e.g. 1am → “Good night”).
 */
export function timeOfDayGreeting(date: Date = new Date()): string {
  const h = date.getHours();
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 17) return "Good afternoon";
  if (h >= 17 && h < 21) return "Good evening";
  return "Good night";
}
