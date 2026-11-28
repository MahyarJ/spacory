import { FloatingBar } from "@ui/FloatingBar";
import { DrawingTools } from "./DrawingTools";
import { EditorSettings } from "./EditorSettings";
import { HintBar } from "./HintBar";
import { ProjectActions } from "./ProjectActions";
import styles from "./Toolbar.module.css";

export function Toolbar() {
  return (
    <div className={styles.toolbar}>
      <div className={styles.editorTools}>
        <h1 className={styles.wordmark} aria-label="Spacory">
          S
        </h1>
        <div className={styles.drawing}>
          <DrawingTools className={styles.tools} />
          <div className={styles.hint}>
            <HintBar />
          </div>
        </div>
      </div>
      <FloatingBar
        aria-label="Project actions"
        className={styles.projectActions}
      >
        <ProjectActions />
        <EditorSettings />
      </FloatingBar>
    </div>
  );
}
