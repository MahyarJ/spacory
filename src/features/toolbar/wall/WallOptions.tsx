import { type Fixture, MIN_FIXTURE_DIMENSION } from "@app/schema";
import {
  type SelectionAction,
  selectionActions,
  selectionCount,
} from "@app/selection";
import { useApp } from "@app/store";
import { MIN_OPENING_WIDTH } from "@geometry/opening";
import { getWallLength, MIN_WALL_LENGTH } from "@geometry/wall";
import { ICON_SIZE } from "@ui/constants";
import {
  Copy,
  SquareCenterlineDashedHorizontal,
  SquareCenterlineDashedVertical,
  Trash2,
} from "lucide-react";
import { LengthField } from "./LengthField";
import { ThicknessOptions } from "./ThicknessOptions";
import styles from "./WallOptions.module.css";
import { WallResizeControls } from "./WallResizeControls";

export function WallOptions() {
  const tool = useApp((s) => s.tool);
  const selectedWalls = useApp((s) => s.selectedWalls);
  const selectedItems = useApp((s) => s.selectedItems);
  const selectedLabels = useApp((s) => s.selectedLabels);
  const selectedFixtures = useApp((s) => s.selectedFixtures);
  const plan = useApp((s) => s.plan);
  const { walls, items } = plan;
  const system = plan.meta.measurementSystem;
  const setWallLength = useApp((s) => s.setSelectedWallLength);
  const setOpeningWidth = useApp((s) => s.setSelectedOpeningWidth);
  const updateFixture = useApp((s) => s.updateFixture);

  const canEditMeasurement =
    tool === "select" &&
    selectionCount(
      selectedWalls,
      selectedItems,
      selectedLabels,
      selectedFixtures,
    ) === 1;
  const selectedWall =
    canEditMeasurement && selectedWalls.size === 1
      ? walls.find((w) => selectedWalls.has(w.id))
      : undefined;
  const selectedOpening =
    canEditMeasurement && selectedItems.size === 1
      ? items.find((i) => selectedItems.has(i.id))
      : undefined;
  const selectedFixture =
    canEditMeasurement && selectedFixtures.size === 1
      ? plan.fixtures?.find((fixture) => selectedFixtures.has(fixture.id))
      : undefined;

  const actions =
    tool === "select"
      ? selectionActions(
          plan,
          selectedWalls,
          selectedItems,
          selectedLabels,
          selectedFixtures,
        )
      : [];

  return (
    <div className={styles.wallOptions}>
      {tool === "wall" && <ThicknessOptions />}

      {selectedWall && (
        // Key by id so a different selection resets the field's local draft.
        <LengthField
          key={selectedWall.id}
          id="wall-length-input"
          label="Length"
          lengthCm={getWallLength(selectedWall)}
          minCm={MIN_WALL_LENGTH}
          system={system}
          onCommit={(length) =>
            setWallLength(length, useApp.getState().wallLengthEdit?.anchor)
          }
          renderControls={(length) => (
            <WallResizeControls wall={selectedWall} length={length} />
          )}
        />
      )}

      {selectedOpening && (
        // Key by id so switching selection resets the field's local draft.
        <LengthField
          key={selectedOpening.id}
          id="opening-width-input"
          label="Width"
          lengthCm={selectedOpening.wallAttach.length}
          minCm={MIN_OPENING_WIDTH}
          system={system}
          onCommit={setOpeningWidth}
        />
      )}

      {selectedFixture && (
        <div className={styles.wallOptions} key={selectedFixture.id}>
          <LengthField
            id="fixture-width-input"
            label="Width"
            lengthCm={selectedFixture.wallAttach.length}
            minCm={MIN_FIXTURE_DIMENSION}
            system={system}
            onCommit={(width) => updateFixture(selectedFixture.id, { width })}
          />
          <LengthField
            id="fixture-depth-input"
            label="Depth"
            lengthCm={selectedFixture.depth}
            minCm={MIN_FIXTURE_DIMENSION}
            system={system}
            onCommit={(depth) => updateFixture(selectedFixture.id, { depth })}
          />
        </div>
      )}
      {actions.length > 0 && (
        <SelectionActionButtons actions={actions} fixture={selectedFixture} />
      )}
    </div>
  );
}

/**
 * Selection controls for mouse and touch. Actions with keyboard shortcuts
 * share the same store commands, so either input creates one undo step.
 */
function SelectionActionButtons({
  actions,
  fixture,
}: {
  actions: SelectionAction[];
  fixture?: Fixture;
}) {
  const deleteSelected = useApp((s) => s.deleteSelected);
  const toggleHinge = useApp((s) => s.toggleSelectedDoorHingeEdge);
  const toggleSwing = useApp((s) => s.toggleSelectedDoorSwingSide);
  const duplicateFixture = useApp((s) => s.duplicateFixture);

  // Icon-only, so each needs an explicit accessible name; the tooltip names the
  // accelerator too, so the bar teaches the shortcut instead of replacing it.
  const config: Record<
    SelectionAction,
    { label: string; title: string; icon: React.ReactNode; onClick: () => void }
  > = {
    remove: {
      label: "Remove",
      title: "Remove (Delete)",
      icon: <Trash2 size={ICON_SIZE} />,
      onClick: deleteSelected,
    },
    // The hinge moves along the wall, the swing flips across it — hence one
    // glyph mirrored on two axes. Both families name the *split*, not the line
    // they draw: `…Horizontal` splits the square left/right about a vertical
    // dashed centerline (along the wall), `…Vertical` splits it top/bottom
    // about a horizontal one (across the wall), exactly as `FlipHorizontal2` /
    // `FlipVertical2` read before them. Keep them a pair — that axis contrast
    // is the only thing telling two 18px icon-only buttons apart.
    hinge: {
      label: "Toggle hinge",
      title: "Toggle hinge (H)",
      icon: <SquareCenterlineDashedHorizontal size={ICON_SIZE} />,
      onClick: toggleHinge,
    },
    swing: {
      label: "Toggle swing",
      title: "Toggle swing (S)",
      icon: <SquareCenterlineDashedVertical size={ICON_SIZE} />,
      onClick: toggleSwing,
    },
    duplicate: {
      label: "Duplicate",
      title: "Duplicate",
      icon: <Copy size={ICON_SIZE} />,
      onClick: () => {
        if (fixture) duplicateFixture(fixture.id);
      },
    },
  };

  return (
    <div className={styles.actions}>
      {actions.map((action) => {
        const { label, title, icon, onClick } = config[action];
        return (
          <button
            key={action}
            type="button"
            className={styles.actionButton}
            aria-label={label}
            title={title}
            onClick={onClick}
          >
            {icon}
          </button>
        );
      })}
    </div>
  );
}
