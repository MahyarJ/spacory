import { useApp } from "@app/store";
import { computeWallGeometry, polygonToPoints } from "@geometry/junction";
import { useMemo } from "react";

export function WallsLayer() {
  const walls = useApp((s) => s.plan.walls);
  const { walls: polygons, junctions } = useMemo(
    () => computeWallGeometry(walls),
    [walls],
  );

  return (
    <g data-layer="walls">
      {walls.map((w) => {
        const quad = polygons.get(w.id);
        if (!quad) return null;
        return (
          <polygon
            key={w.id}
            points={polygonToPoints(quad)}
            fill="var(--sp-wall)"
            stroke="none"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {/* Fill junction cores (3+-wall) and beveled-corner gaps so they read as solid. */}
      {junctions.map((poly) => (
        <polygon
          key={`junction-${polygonToPoints(poly)}`}
          points={polygonToPoints(poly)}
          fill="var(--sp-wall)"
          stroke="none"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
}
