export function AppLogo({ size = 40 }: { size?: number }) {
  return (
    <div className="brand-mark" style={{ width: size, height: size }} aria-label="Workdeck">
      <span className="brand-orbit" />
      <span className="brand-node brand-node-a" />
      <span className="brand-node brand-node-b" />
      <span className="brand-line" />
    </div>
  );
}
