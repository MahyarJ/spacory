import { useApp } from "@app/store";
import { IconButton } from "@ui/Button";
import { ICON_SIZE } from "@ui/constants";
import { FloatingBar } from "@ui/FloatingBar";
import { Redo2, Undo2 } from "lucide-react";
import { DrawingTools } from "./DrawingTools";
import { EditorSettings } from "./EditorSettings";
import { HintBar } from "./HintBar";
import { ProjectActions } from "./ProjectActions";
import styles from "./Toolbar.module.css";

export function Toolbar() {
  const undo = useApp((s) => s.undo);
  const redo = useApp((s) => s.redo);

  return (
    <>
      <div className={styles.toolbar}>
        <h1 className={styles.wordmark}>Spacory</h1>
        <DrawingTools className={styles.tools} />
        <div className={styles.commands}>
          <FloatingBar aria-label="Edit history">
            <IconButton label="Undo" onClick={undo}>
              <Undo2 size={ICON_SIZE} aria-hidden="true" />
            </IconButton>
            <IconButton label="Redo" onClick={redo}>
              <Redo2 size={ICON_SIZE} aria-hidden="true" />
            </IconButton>
          </FloatingBar>
          <FloatingBar aria-label="Project actions">
            <ProjectActions />
            <EditorSettings />
          </FloatingBar>
        </div>
      </div>
      <HintBar />
    </>
  );
}
