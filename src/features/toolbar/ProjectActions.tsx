import { PlanParseError, parsePlan, serializePlan } from "@app/io";
import { useApp } from "@app/store";
import { buildExportSvg } from "@geometry/exportSvg";
import { Download, Image as ImageIcon, Upload } from "lucide-react";
import { useRef } from "react";
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

function exportPlanAsPng(plan: ReturnType<typeof useApp.getState>["plan"]) {
  const { markup, width, height } = buildExportSvg(plan);
  const svgBlob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);

  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * PNG_EXPORT_SCALE);
    canvas.height = Math.round(height * PNG_EXPORT_SCALE);
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
      downloadBlob(pngBlob, `${sanitizeFilename(plan.meta.name)}.png`);
    }, "image/png");
  };
  image.onerror = () => {
    URL.revokeObjectURL(svgUrl);
    window.alert("Could not export PNG.");
  };
  image.src = svgUrl;
}

export function ProjectActions() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const onExport = () => {
    const plan = useApp.getState().plan;
    const blob = new Blob([serializePlan(plan)], { type: "application/json" });
    downloadBlob(blob, `${sanitizeFilename(plan.meta.name)}.json`);
  };

  const onExportPng = () => exportPlanAsPng(useApp.getState().plan);

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
        <Upload size={18} />
        Import
      </button>
      <button type="button" className={styles.button} onClick={onExport}>
        <Download size={18} />
        Export
      </button>
      <button type="button" className={styles.button} onClick={onExportPng}>
        <ImageIcon size={18} />
        Export PNG
      </button>
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
