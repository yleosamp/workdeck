export function formatDuration(seconds: number, compact = false) {
  if (seconds <= 0) return compact ? "0m" : "0 minutes";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (!hours) return compact ? `${minutes}m` : `${minutes} minutes`;
  if (!minutes) return compact ? `${hours}h` : `${hours} hours`;
  return `${hours}h ${minutes}m`;
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function friendlyDate(dateKey: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(`${dateKey}T12:00:00`)
  );
}

export function percentChange(current: number, previous: number) {
  if (!previous) return 100;
  return Math.round(((current - previous) / previous) * 100);
}
