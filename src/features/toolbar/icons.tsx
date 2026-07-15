/**
 * Domain-specific toolbar glyphs (wall / window) that no generic icon set
 * covers well. Drawn on Lucide's grid — 24×24 viewBox, `currentColor` stroke,
 * `stroke-width: 2`, round caps/joins — so they sit consistently alongside the
 * `lucide-react` icons used elsewhere in the toolbar. (The door tool currently
 * borrows lucide's `DoorOpen`; a custom plan-view swing glyph can come later.)
 */

type DomainIconProps = {
  /** Rendered width/height in px. Matches lucide-react's `size` prop. */
  size?: string | number;
  className?: string;
};

function DomainIcon({
  size = 18,
  className,
  children,
}: DomainIconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** A running-bond brick pattern — the wall-drawing tool. */
export function WallIcon(props: DomainIconProps) {
  return (
    <DomainIcon {...props}>
      <rect x={3} y={4} width={18} height={16} rx={1} />
      <line x1={3} y1={9} x2={21} y2={9} />
      <line x1={3} y1={15} x2={21} y2={15} />
      <line x1={9} y1={4} x2={9} y2={9} />
      <line x1={15} y1={4} x2={15} y2={9} />
      <line x1={6} y1={9} x2={6} y2={15} />
      <line x1={12} y1={9} x2={12} y2={15} />
      <line x1={18} y1={9} x2={18} y2={15} />
      <line x1={9} y1={15} x2={9} y2={20} />
      <line x1={15} y1={15} x2={15} y2={20} />
    </DomainIcon>
  );
}

/** A four-pane frame — the window tool. */
export function WindowIcon(props: DomainIconProps) {
  return (
    <DomainIcon {...props}>
      <rect x={4} y={4} width={16} height={16} rx={1} />
      <line x1={12} y1={4} x2={12} y2={20} />
      <line x1={4} y1={12} x2={20} y2={12} />
    </DomainIcon>
  );
}
