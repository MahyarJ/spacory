import { PlanParseError, parsePlan, serializePlan } from "@app/io";
import { DEFAULT_PLAN_NAME, type Plan } from "@app/schema";
import { useApp } from "@app/store";
import {
  buildExportSvg,
  EXPORT_MARGIN,
  type ExportSvgResult,
} from "@geometry/exportSvg";
import buttons from "@ui/Button.module.css";
import { ICON_SIZE } from "@ui/constants";
import { ErrorNotice } from "@ui/ErrorNotice";
import { Menu } from "@ui/Menu";
import { Modal } from "@ui/Modal";
import { createPlanLabelMeasurer } from "@ui/planLabelMeasurer";
import { createRoomLabelMeasurer } from "@ui/roomLabelMeasurer";
import {
  Check,
  Copy,
  Download,
  FileJson,
  Image as ImageIcon,
  LoaderCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import imageStyles from "./ExportImageDialog.module.css";
import toolbarStyles from "./Toolbar.module.css";

const DEFAULT_EXPORT_FILENAME = "floor-plan";
const PNG_ERROR_MESSAGE =
  "Couldn’t prepare the PNG. Try again or download the SVG.";
const COPY_ERROR_MESSAGE = "Couldn’t copy. Try again or download the PNG.";

function exportFilenameBase(name: string): string {
  const title = name.trim();
  if (title === DEFAULT_PLAN_NAME) return DEFAULT_EXPORT_FILENAME;
  const cleaned = title.replace(/[^a-z0-9-_ ]/gi, "").replace(/\s+/g, "-");
  return cleaned || DEFAULT_EXPORT_FILENAME;
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

const COPY_CONFIRMATION_MS = 2000;

function ExportImageDialog({
  plan,
  onClose,
  preparingPng,
  onDownloadPng,
  copyBusy,
  onCopy,
  errorMessage,
  onErrorChange,
}: {
  plan: Plan;
  onClose: () => void;
  preparingPng: boolean;
  onDownloadPng: (svg: ExportSvgResult, filename: string) => Promise<void>;
  copyBusy: boolean;
  onCopy: (svg: ExportSvgResult) => Promise<boolean>;
  errorMessage: string;
  onErrorChange: (message: string) => void;
}) {
  const [wallLengths, setWallLengths] = useState(true);
  const [roomAreas, setRoomAreas] = useState(true);
  const [copied, setCopied] = useState(false);
  const exportBusy = preparingPng || copyBusy;
  const PngIcon = preparingPng ? LoaderCircle : Download;
  const CopyIcon = copyBusy ? LoaderCircle : Copy;

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(
      () => setCopied(false),
      COPY_CONFIRMATION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [copied]);

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
  const previewSrc = useMemo(
    () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.markup)}`,
    [svg.markup],
  );
  const filename = exportFilenameBase(plan.meta.name);
  const canCopyImage =
    typeof ClipboardItem !== "undefined" &&
    typeof navigator.clipboard?.write === "function";

  const copyImage = async () => {
    setCopied(false);
    onErrorChange("");
    try {
      if (await onCopy(svg)) setCopied(true);
    } catch {
      onErrorChange(COPY_ERROR_MESSAGE);
    }
  };

  return (
    <Modal
      title="Export image"
      closeLabel="Close export dialog"
      onClose={onClose}
      dismissOnBackdrop={!exportBusy}
    >
      <div className={imageStyles.body}>
        <img
          className={imageStyles.preview}
          alt="Floor plan preview"
          src={previewSrc}
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
          className={`${buttons.button} ${imageStyles.primary}`}
          aria-label="Download PNG"
          title="Download PNG"
          disabled={preparingPng}
          onClick={() => onDownloadPng(svg, `${filename}.png`)}
        >
          <PngIcon
            className={preparingPng ? imageStyles.loader : undefined}
            size={ICON_SIZE}
            aria-hidden="true"
          />
          PNG
        </button>
        <span
          className={imageStyles.statusAnnouncement}
          role="status"
          aria-label="PNG download"
        >
          {preparingPng && "Preparing PNG…"}
        </span>
        <button
          type="button"
          className={buttons.button}
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
              className={`${buttons.button} ${imageStyles.statusButton}`}
              aria-label="Copy image"
              disabled={copyBusy}
              data-copied={copied}
              onClick={copyImage}
            >
              <span
                className={imageStyles.statusLabel}
                data-visible={!copied}
                aria-hidden="true"
              >
                <CopyIcon
                  className={copyBusy ? imageStyles.loader : undefined}
                  size={ICON_SIZE}
                />
                Copy image
              </span>
              <span
                className={imageStyles.statusLabel}
                data-visible={copied}
                aria-hidden="true"
              >
                <Check size={ICON_SIZE} />
                Copied
              </span>
            </button>
            <span
              className={imageStyles.statusAnnouncement}
              role="status"
              aria-label="Image copy"
            >
              {copied && "Image copied."}
              {copyBusy && "Copying image…"}
            </span>
          </>
        )}
        <ErrorNotice
          message={errorMessage}
          className={imageStyles.exportError}
        />
      </div>
    </Modal>
  );
}

export function ProjectActions() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [imagePlan, setImagePlan] = useState<Plan | null>(null);
  // Export work can finish after the dialog is dismissed. Keep its errors
  // available in the toolbar when there is no open dialog to display them.
  const [exportError, setExportError] = useState("");
  const pngInFlight = useRef(false);
  const [preparingPng, setPreparingPng] = useState(false);
  const copyInFlight = useRef(false);
  const [copyBusy, setCopyBusy] = useState(false);

  const downloadPng = async (svg: ExportSvgResult, filename: string) => {
    if (pngInFlight.current) return;
    pngInFlight.current = true;
    setPreparingPng(true);
    setExportError("");
    try {
      downloadBlob(await buildExportPng(svg), filename);
    } catch {
      setExportError(PNG_ERROR_MESSAGE);
    } finally {
      pngInFlight.current = false;
      setPreparingPng(false);
    }
  };

  const copyExportImage = async (svg: ExportSvgResult) => {
    // The clipboard write can finish after the export dialog is dismissed.
    if (copyInFlight.current) return false;
    copyInFlight.current = true;
    setCopyBusy(true);
    try {
      const png = buildExportPng(svg);
      // The browser can reject the write before it reads the PNG promise.
      void png.catch(() => {});
      // Start the write in the click handler to preserve Safari's user gesture.
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": png }),
      ]);
      return true;
    } finally {
      copyInFlight.current = false;
      setCopyBusy(false);
    }
  };

  const onExport = () => {
    const plan = useApp.getState().plan;
    const blob = new Blob([serializePlan(plan)], { type: "application/json" });
    downloadBlob(blob, `${exportFilenameBase(plan.meta.name)}.json`);
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
      <button
        type="button"
        className={toolbarStyles.textButton}
        onClick={onImportClick}
      >
        Import
      </button>
      <Menu
        label="Export"
        triggerClassName={toolbarStyles.textButton}
        items={[
          {
            key: "image",
            label: "Image…",
            icon: <ImageIcon size={ICON_SIZE} />,
            onSelect: () => {
              setExportError("");
              setImagePlan(useApp.getState().plan);
            },
          },
          {
            key: "json",
            label: "JSON",
            icon: <FileJson size={ICON_SIZE} />,
            onSelect: onExport,
          },
        ]}
      />
      <ErrorNotice
        className={toolbarStyles.exportError}
        message={imagePlan ? "" : exportError}
      />
      {imagePlan && (
        <ExportImageDialog
          plan={imagePlan}
          onClose={() => {
            setExportError("");
            setImagePlan(null);
          }}
          preparingPng={preparingPng}
          onDownloadPng={downloadPng}
          copyBusy={copyBusy}
          onCopy={copyExportImage}
          errorMessage={exportError}
          onErrorChange={setExportError}
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
