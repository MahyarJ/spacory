import { type SelectionAction, selectionActions } from "@app/selection";
import { useApp } from "@app/store";
import { ICON_SIZE } from "@features/toolbar/constants";
import { MIN_OPENING_WIDTH } from "@geometry/opening";
import { getWallLength, MIN_WALL_LENGTH } from "@geometry/wall";
import {
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
  const plan = useApp((s) => s.plan);
  const { walls, items } = plan;
  const system = plan.meta.measurementSystem;
  const setWallLength = useApp((s) => s.setSelectedWallLength);
  const setOpeningWidth = useApp((s) => s.setSelectedOpeningWidth);

  // Length editing is a single-wall affair (see issue scope) and walls are only
  // selectable with the select tool. Gate on that tool too: a selection
  // persists across tool switches, so without it the field would leak into the
  // window/door/pan toolbars.
  const selectedWall =
    tool === "select" && selectedWalls.size === 1
      ? walls.find((w) => selectedWalls.has(w.id))
      : undefined;

  // Width editing mirrors wall-length editing, but for a single selected opening
  // (door/window). Same tool gate as above, for the same reason.
  const selectedOpening =
    tool === "select" && selectedItems.size === 1
      ? items.find((i) => selectedItems.has(i.id))
      : undefined;

  // Same tool gate again: a selection outlives a tool switch, so without it the
  // action buttons would follow it into the wall/door/window/pan toolbars. The
  // keyboard shortcuts stay tool-independent — predictability beats parity.
  const actions =
    tool === "select"
      ? selectionActions(plan, selectedWalls, selectedItems)
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

      {actions.length > 0 && <SelectionActionButtons actions={actions} />}
    </div>
  );
}

/**
 * On-screen equivalents of the selection's keyboard verbs, so a tablet user can
 * edit what they drew. Each button calls the very same store action the key
 * press does, so it commits once and is one undo entry — no second write path.
 */
function SelectionActionButtons({ actions }: { actions: SelectionAction[] }) {
  const deleteSelected = useApp((s) => s.deleteSelected);
  const toggleHinge = useApp((s) => s.toggleSelectedDoorHingeEdge);
  const toggleSwing = useApp((s) => s.toggleSelectedDoorSwingSide);

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
