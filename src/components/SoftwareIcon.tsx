import type { TrackedApp } from "../types";

export function SoftwareIcon({ app, size = "md" }: { app: TrackedApp; size?: "sm" | "md" | "lg" }) {
  return (
    <div
      className={`software-icon software-icon-${size}`}
      style={{ "--app-color": app.color, "--app-glow": app.glow } as React.CSSProperties}
      aria-label={app.name}
    >
      {app.shortName}
    </div>
  );
}
