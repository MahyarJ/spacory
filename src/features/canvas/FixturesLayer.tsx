import type { Fixture, Wall } from "@app/schema";
import {
  FIXTURE_STROKE_WIDTH,
  type FixtureFootprint,
  getFixtureGeometry,
  getFixtureSymbol,
} from "@geometry/fixtures";

function FixtureSymbol({
  footprint,
  filling,
  preview = false,
  selected = false,
}: {
  footprint: FixtureFootprint;
  filling: string;
  preview?: boolean;
  selected?: boolean;
}) {
  const { rim, basin, drain, tap } = getFixtureSymbol(footprint);
  return (
    <>
      <rect
        {...rim}
        fill={filling}
        fillOpacity={preview ? 0.2 : undefined}
        strokeWidth={preview ? 2 : undefined}
        vectorEffect={preview ? "non-scaling-stroke" : undefined}
      />
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
    </>
  );
}

export function SinkPreview({
  footprint,
  wall,
  blocked,
}: {
  footprint: FixtureFootprint;
  wall: Wall;
  blocked: boolean;
}) {
  const color = blocked ? "var(--sp-sink-blocked)" : "var(--sp-accent)";
  return (
    <g
      data-fixture-preview={blocked ? "blocked" : "valid"}
      transform={getFixtureGeometry(footprint, wall).transform}
      stroke={color}
      strokeWidth={FIXTURE_STROKE_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
      pointerEvents="none"
    >
      <FixtureSymbol footprint={footprint} filling={color} preview />
    </g>
  );
}

export function FixturesLayer({
  fixtures,
  wallsById,
  selectedIds,
  hiddenId,
}: {
  fixtures?: Fixture[];
  wallsById: ReadonlyMap<string, Wall>;
  selectedIds: ReadonlySet<string>;
  hiddenId?: string;
}) {
  return (
    <g data-layer="fixtures" pointerEvents="none">
      {fixtures?.map((fixture) => {
        const wall = wallsById.get(fixture.wallAttach.wallId);
        if (!wall || fixture.id === hiddenId) return null;
        return (
          <g
            key={fixture.id}
            data-fixture={fixture.type}
            transform={getFixtureGeometry(fixture, wall).transform}
            stroke="var(--sp-wall)"
            strokeWidth={FIXTURE_STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <FixtureSymbol
              footprint={fixture}
              filling="var(--sp-bg)"
              selected={selectedIds.has(fixture.id)}
            />
          </g>
        );
      })}
    </g>
  );
}
