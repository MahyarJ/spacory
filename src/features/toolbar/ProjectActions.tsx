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
import {
  Check,
  Copy,
  Download,
  FileJson,
  FolderOpen,
  Image as ImageIcon,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
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

async function buildExportPng({ markup, width, height }: ExportSvgResult) {
  const svgUrl = URL.createObjectURL(exportSvgBlob(markup));
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Could not export PNG."));
      image.src = svgUrl;
    });

    const canvas = document.createElement("canvas");
    const raster = pngRasterSize(width, height);
    canvas.width = raster.width;
    canvas.height = raster.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Could not export PNG: canvas is unsupported.");
    }
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not export PNG."));
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

type CopyStatus = "idle" | "copying" | "copied" | "failed";

const COPY_LABELS = [
  { status: "idle", label: "Copy image", Icon: Copy },
  { status: "copying", label: "Copying…", Icon: Copy },
  { status: "copied", label: "Copied", Icon: Check },
] as const;

const COPY_CONFIRMATION_MS = 2000;

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
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const copyBusy = copyStatus === "copying";
  const visibleCopyLabel =
    copyStatus === "copying" || copyStatus === "copied" ? copyStatus : "idle";

  useEffect(() => {
    dialogRef.current!.showModal();
  }, []);

  useEffect(() => {
    if (copyStatus !== "copied") return;
    const timer = window.setTimeout(() => {
      setCopyStatus((current) => (current === "copied" ? "idle" : current));
    }, COPY_CONFIRMATION_MS);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  const close = () => {
    dialogRef.current!.close();
    onClose();
  };

  const svg = useMemo(
    () =>
      buildExportSvg(
        plan,
        EXPORT_MARGIN,
        createRoomLabelMeasurer(),
        plan.labels?.length ? createPlanLabelMeasurer() : undefined,
        { wallLengths, roomAreas },
      ),
    [plan, wallLengths, roomAreas],
  );
  const filename = sanitizeFilename(plan.meta.name);
  const canCopyImage =
    typeof ClipboardItem !== "undefined" &&
    typeof navigator.clipboard?.write === "function";

  const downloadPng = async () => {
    try {
      downloadBlob(await buildExportPng(svg), `${filename}.png`);
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Could not export PNG.",
      );
    }
  };

  const copyImage = async () => {
    setCopyStatus("copying");
    const png = buildExportPng(svg);
    // The browser can reject the write before it reads the PNG promise.
    void png.catch(() => {});
    try {
      // Safari needs the write to start in the click handler, before PNG encoding.
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": png }),
      ]);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };

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
      <header className={imageStyles.header}>
        <h2 id={titleId} className={imageStyles.title}>
          Export image
        </h2>
        <button
          type="button"
          className={`${styles.button} ${imageStyles.close}`}
          aria-label="Close export dialog"
          title="Close"
          onClick={close}
        >
          <X size={ICON_SIZE} aria-hidden="true" />
        </button>
      </header>
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
        <button
          type="button"
          className={`${styles.button} ${imageStyles.primary}`}
          aria-label="Download PNG"
          title="Download PNG"
          onClick={downloadPng}
        >
          <Download size={ICON_SIZE} aria-hidden="true" />
          PNG
        </button>
        <button
          type="button"
          className={styles.button}
          aria-label="Download SVG"
          title="Download SVG"
          onClick={() =>
            downloadBlob(exportSvgBlob(svg.markup), `${filename}.svg`)
          }
        >
          <Download size={ICON_SIZE} aria-hidden="true" />
          SVG
        </button>
        {canCopyImage && (
          <>
            <button
              type="button"
              className={`${styles.button} ${imageStyles.copyButton}`}
              aria-label="Copy image"
              disabled={copyBusy}
              data-copied={copyStatus === "copied"}
              onClick={copyImage}
            >
              {COPY_LABELS.map(({ status, label, Icon }) => (
                <span
                  key={status}
                  className={imageStyles.copyLabel}
                  data-visible={visibleCopyLabel === status}
                  aria-hidden="true"
                >
                  <Icon size={ICON_SIZE} />
                  {label}
                </span>
              ))}
            </button>
            <span className={imageStyles.copyAnnouncement} role="status">
              {visibleCopyLabel === "copied" && "Image copied."}
              {visibleCopyLabel === "copying" && "Copying image…"}
            </span>
            <div className={imageStyles.copyError} role="alert">
              {copyStatus === "failed" &&
                "Couldn’t copy. Try again or download the PNG."}
            </div>
          </>
        )}
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
        <FolderOpen size={ICON_SIZE} aria-hidden="true" />
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
