import { PlanParseError, parsePlan, serializePlan } from "@app/io";
import type { Plan } from "@app/schema";
import { useApp } from "@app/store";
import {
  buildExportSvg,
  EXPORT_MARGIN,
  type ExportSvgResult,
} from "@geometry/exportSvg";
import { Menu } from "@ui/Menu";
import { createPlanLabelMeasurer } from "@ui/planLabelMeasurer";
import { createRoomLabelMeasurer } from "@ui/roomLabelMeasurer";
import { Download, FileJson, Image as ImageIcon, Upload } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ICON_SIZE } from "./constants";
import imageStyles from "./ExportImageDialog.module.css";
import styles from "./Toolbar.module.css";

function sanitizeFilename(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^a-z0-9-_ ]/gi, "")
    .replace(/\s+/g, "-");
  return cleaned || "spacory-plan";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Raster the export SVG at this multiple of its cm dimensions, so the PNG is
 *  legible rather than blurry (cm and px are 1:1 on the live canvas). */
const PNG_EXPORT_SCALE = 2;
// Allow wide floor plans while staying within the canvas area supported by
// older iOS WebKit versions (4096 × 4096 pixels).
const MAX_PNG_SIDE = 8192;
const MAX_PNG_PIXELS = 4096 ** 2;

function pngRasterSize(width: number, height: number) {
  const pixelsWide = Math.max(1, Math.round(width * PNG_EXPORT_SCALE));
  const pixelsHigh = Math.max(1, Math.round(height * PNG_EXPORT_SCALE));
  const scale = Math.min(
    1,
    MAX_PNG_SIDE / pixelsWide,
    MAX_PNG_SIDE / pixelsHigh,
    Math.sqrt(MAX_PNG_PIXELS / pixelsWide / pixelsHigh),
  );
  return {
    width: Math.max(1, Math.floor(pixelsWide * scale)),
    height: Math.max(1, Math.floor(pixelsHigh * scale)),
  };
}

function exportSvgBlob(markup: string): Blob {
  return new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
}

function exportPlanAsPng(
  { markup, width, height }: ExportSvgResult,
  filename: string,
) {
  const svgBlob = exportSvgBlob(markup);
  const svgUrl = URL.createObjectURL(svgBlob);

  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement("canvas");
    const raster = pngRasterSize(width, height);
    canvas.width = raster.width;
    canvas.height = raster.height;
    const ctx = canvas.getContext("2d");
    URL.revokeObjectURL(svgUrl);
    if (!ctx) {
      window.alert("Could not export PNG: canvas is unsupported.");
      return;
    }
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((pngBlob) => {
      if (!pngBlob) {
        window.alert("Could not export PNG.");
        return;
      }
      downloadBlob(pngBlob, filename);
    }, "image/png");
  };
  image.onerror = () => {
    URL.revokeObjectURL(svgUrl);
    window.alert("Could not export PNG.");
  };
  image.src = svgUrl;
}

function ExportImageDialog({
  plan,
  onClose,
}: {
  plan: Plan;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [wallLengths, setWallLengths] = useState(true);
  const [roomAreas, setRoomAreas] = useState(true);

  useEffect(() => {
    dialogRef.current!.showModal();
  }, []);

  const close = () => {
    dialogRef.current!.close();
    onClose();
  };

  const svg = buildExportSvg(
    plan,
    EXPORT_MARGIN,
    createRoomLabelMeasurer(),
    plan.labels?.length ? createPlanLabelMeasurer() : undefined,
    { wallLengths, roomAreas },
  );
  const filename = sanitizeFilename(plan.meta.name);

  return (
    <dialog
      className={imageStyles.dialog}
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      // Preserve native control navigation and Escape's cancel event while
      // keeping keyboard events away from the editor's window listener.
      onKeyDown={(e) => e.stopPropagation()}
    >
      <h2 id={titleId} className={imageStyles.title}>
        Export image
      </h2>
      <div className={imageStyles.body}>
        <img
          className={imageStyles.preview}
          alt="Floor plan preview"
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.markup)}`}
        />
        <div className={imageStyles.options}>
          <label>
            <input
              type="checkbox"
              checked={wallLengths}
              onChange={(e) => setWallLengths(e.target.checked)}
            />
            Wall lengths
          </label>
          <label>
            <input
              type="checkbox"
              checked={roomAreas}
              onChange={(e) => setRoomAreas(e.target.checked)}
            />
            Room areas
          </label>
        </div>
      </div>
      <div className={imageStyles.actions}>
        <button type="button" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => exportPlanAsPng(svg, `${filename}.png`)}
        >
          Download PNG
        </button>
        <button
          type="button"
          onClick={() =>
            downloadBlob(exportSvgBlob(svg.markup), `${filename}.svg`)
          }
        >
          Download SVG
        </button>
      </div>
    </dialog>
  );
}

export function ProjectActions() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [imagePlan, setImagePlan] = useState<Plan | null>(null);

  const onExport = () => {
    const plan = useApp.getState().plan;
    const blob = new Blob([serializePlan(plan)], { type: "application/json" });
    downloadBlob(blob, `${sanitizeFilename(plan.meta.name)}.json`);
  };

  const onImportClick = () => fileInputRef.current?.click();

  const onFileChange: React.ChangeEventHandler<HTMLInputElement> = async (
    e,
  ) => {
    const file = e.target.files?.[0];
    // Reset so picking the same file again still fires onChange.
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const plan = parsePlan(text);
      useApp.getState().loadPlan(plan);
    } catch (err) {
      const message =
        err instanceof PlanParseError
          ? err.message
          : "Could not read that file.";
      window.alert(`Import failed: ${message}`);
    }
  };

  return (
    <>
      <button type="button" className={styles.button} onClick={onImportClick}>
        <Download size={ICON_SIZE} />
        Import
      </button>
      <Menu
        label="Export"
        icon={<Upload size={ICON_SIZE} />}
        triggerClassName={styles.button}
        items={[
          {
            key: "image",
            label: "Image…",
            icon: <ImageIcon size={ICON_SIZE} />,
            onSelect: () => setImagePlan(useApp.getState().plan),
          },
          {
            key: "json",
            label: "JSON",
            icon: <FileJson size={ICON_SIZE} />,
            onSelect: onExport,
          },
        ]}
      />
      {imagePlan && (
        <ExportImageDialog
          plan={imagePlan}
          onClose={() => setImagePlan(null)}
        />
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={onFileChange}
        style={{ display: "none" }}
      />
    </>
  );
}
