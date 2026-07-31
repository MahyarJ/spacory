import { canvasHintForPointer } from "@app/canvasHint";
import { usePointerKind } from "@ui/usePointerKind";
import styles from "./CanvasHint.module.css";

/**
 * The pan/zoom advice, as a caption in the canvas's bottom-right corner.
 *
 * Which text to show (if any) is `canvasHintForPointer`'s call — this only
 * renders it.
 */
export function CanvasHint() {
  const text = canvasHintForPointer(usePointerKind());
  if (!text) return null;
  return <div className={styles.hint}>{text}</div>;
}
