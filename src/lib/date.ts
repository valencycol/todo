const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Stockholm",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDate(ms: number): string {
  return formatter.format(new Date(ms));
}
