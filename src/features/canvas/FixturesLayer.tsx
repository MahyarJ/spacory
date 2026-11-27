import type { Fixture, Wall } from "@app/schema";
import {
  FIXTURE_STROKE_WIDTH,
  type FixtureFootprint,
  getFixtureGeometry,
  getSinkSymbol,
} from "@geometry/fixtures";
import { SinkSymbol } from "@ui/SinkSymbol";

function CanvasSinkSymbol({
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
  const symbol = getSinkSymbol(footprint.wallAttach.length, footprint.depth);
  return (
    <>
      <SinkSymbol
        symbol={symbol}
        rimStyle={{
          fill: filling,
          fillOpacity: preview ? 0.2 : undefined,
          strokeWidth: preview ? 2 : undefined,
          vectorEffect: preview ? "non-scaling-stroke" : undefined,
        }}
      />
      {selected && (
        <rect
          {...symbol.rim}
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
  const color = blocked ? "var(--sp-preview-blocked)" : "var(--sp-accent)";
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
      <CanvasSinkSymbol footprint={footprint} filling={color} preview />
    </g>
  );
}

export function FixturesLayer({
  fixtures,
  wallsById,
  selectedIds,
  hiddenIds,
}: {
  fixtures?: Fixture[];
  wallsById: ReadonlyMap<string, Wall>;
  selectedIds: ReadonlySet<string>;
  hiddenIds: ReadonlySet<string>;
}) {
  return (
    <g data-layer="fixtures" pointerEvents="none">
      {fixtures?.map((fixture) => {
        const wall = wallsById.get(fixture.wallAttach.wallId);
        if (!wall || hiddenIds.has(fixture.id)) return null;
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
            <CanvasSinkSymbol
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
