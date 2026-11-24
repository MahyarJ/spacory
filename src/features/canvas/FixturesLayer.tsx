import type { Fixture, Wall } from "@app/schema";
import {
  FIXTURE_STROKE_WIDTH,
  getFixtureGeometry,
  getFixtureSymbol,
} from "@geometry/fixtures";

export function FixturesLayer({
  fixtures,
  wallsById,
  selectedIds,
}: {
  fixtures?: Fixture[];
  wallsById: ReadonlyMap<string, Wall>;
  selectedIds: ReadonlySet<string>;
}) {
  return (
    <g data-layer="fixtures" pointerEvents="none">
      {fixtures?.map((fixture) => {
        const wall = wallsById.get(fixture.wallAttach.wallId);
        if (!wall) return null;
        const { transform } = getFixtureGeometry(fixture, wall);
        const { rim, basin, drain, tap } = getFixtureSymbol(fixture);
        const selected = selectedIds.has(fixture.id);
        return (
          <g
            key={fixture.id}
            data-fixture={fixture.type}
            transform={transform}
            stroke="var(--sp-wall)"
            strokeWidth={FIXTURE_STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect {...rim} fill="var(--sp-bg)" />
            <rect {...basin} fill="none" />
            <circle {...drain} fill="none" />
            <path d={tap} fill="none" />
            {selected && (
              <rect
                {...rim}
                data-fixture-selection=""
                fill="none"
                stroke="var(--sp-accent)"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </g>
        );
      })}
    </g>
  );
}
