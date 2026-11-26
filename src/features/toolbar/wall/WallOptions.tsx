import { fixtureConflictMessage, fixtureEditHelp } from "@app/fixtureMessage";
import { type Fixture, MIN_FIXTURE_DIMENSION, type Plan } from "@app/schema";
import {
  type SelectionAction,
  selectionActions,
  selectionCount,
} from "@app/selection";
import { previewFixtureResize, useApp } from "@app/store";
import type { FixtureConflict } from "@geometry/fixtures";
import { MIN_OPENING_WIDTH } from "@geometry/opening";
import { getWallLength, MIN_WALL_LENGTH } from "@geometry/wall";
import { ICON_SIZE } from "@ui/constants";
import {
  Copy,
  SquareCenterlineDashedHorizontal,
  SquareCenterlineDashedVertical,
  Trash2,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
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
  const fixtureResizePreview = useApp((s) => s.fixtureResizePreview);
  const hasLiveDrag = useApp((s) => s.liveDragItems !== null);
  const duplicateFixture = useApp((s) => s.duplicateFixture);
  const [duplicateError, setDuplicateError] = useState<FixtureConflict>();
  const [resizeError, setResizeError] = useState<FixtureConflict>();

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: Clear feedback when the selected fixture or its geometry changes.
  useEffect(() => {
    setDuplicateError(undefined);
    setResizeError(undefined);
  }, [selectedFixture]);
  useEffect(() => {
    if (hasLiveDrag) setResizeError(undefined);
  }, [hasLiveDrag]);
  const duplicateMessage =
    duplicateError && fixtureConflictMessage[duplicateError];
  const resizeConflict =
    fixtureResizePreview &&
    fixtureResizePreview.fixture.id === selectedFixture?.id
      ? fixtureResizePreview.conflict
      : resizeError;

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
            precise
            onCommit={(width) =>
              setResizeError(updateFixture(selectedFixture.id, { width }))
            }
            renderDraft={(length) => (
              <FixtureResizeDraft
                plan={plan}
                fixture={selectedFixture}
                dimension="width"
                length={length}
                setResizeError={setResizeError}
              />
            )}
          />
          <LengthField
            id="fixture-depth-input"
            label="Depth"
            lengthCm={selectedFixture.depth}
            minCm={MIN_FIXTURE_DIMENSION}
            system={system}
            precise
            onCommit={(depth) =>
              setResizeError(updateFixture(selectedFixture.id, { depth }))
            }
            renderDraft={(length) => (
              <FixtureResizeDraft
                plan={plan}
                fixture={selectedFixture}
                dimension="depth"
                length={length}
                setResizeError={setResizeError}
              />
            )}
          />
        </div>
      )}
      {actions.length > 0 && (
        <SelectionActionButtons
          actions={actions}
          onDuplicate={
            selectedFixture &&
            (() => setDuplicateError(duplicateFixture(selectedFixture.id)))
          }
          duplicateMessage={duplicateMessage}
        />
      )}
      {selectedFixture && (
        <>
          <div className={styles.fixtureResizeStatus} role="status">
            {resizeConflict && (
              <>
                {fixtureConflictMessage[resizeConflict]}{" "}
                {fixtureEditHelp[resizeConflict]}
              </>
            )}
          </div>
          <span className={styles.visuallyHidden} role="status">
            {duplicateMessage}
          </span>
        </>
      )}
    </div>
  );
}

function FixtureResizeDraft({
  plan,
  fixture,
  dimension,
  length,
  setResizeError,
}: {
  plan: Plan;
  fixture: Fixture;
  dimension: "width" | "depth";
  length: number | null;
  setResizeError: (conflict?: FixtureConflict) => void;
}) {
  const setPreview = useApp((s) => s.setFixtureResizePreview);
  const preview = useMemo(
    () =>
      length === null
        ? null
        : previewFixtureResize(plan, fixture, { [dimension]: length }),
    [plan, fixture, dimension, length],
  );
  useLayoutEffect(() => {
    if (!preview) return;
    setResizeError(undefined);
    setPreview(preview);
    return () => {
      if (useApp.getState().fixtureResizePreview === preview) setPreview(null);
    };
  }, [preview, setPreview, setResizeError]);
  return null;
}

/**
 * Selection controls for mouse and touch. Actions with keyboard shortcuts
 * share the same store commands, so either input creates one undo step.
 */
function SelectionActionButtons({
  actions,
  onDuplicate,
  duplicateMessage,
}: {
  actions: SelectionAction[];
  onDuplicate?: () => void;
  duplicateMessage?: string;
}) {
  const deleteSelected = useApp((s) => s.deleteSelected);
  const toggleHinge = useApp((s) => s.toggleSelectedDoorHingeEdge);
  const toggleSwing = useApp((s) => s.toggleSelectedDoorSwingSide);

  // Icon-only, so each needs an explicit accessible name; the tooltip names the
  // accelerator too, so the bar teaches the shortcut instead of replacing it.
  const config: Record<
    SelectionAction,
    {
      label: string;
      title: string;
      icon: React.ReactNode;
      onClick?: () => void;
    }
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
      title: duplicateMessage ?? "Duplicate",
      icon: <Copy size={ICON_SIZE} />,
      onClick: onDuplicate,
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
