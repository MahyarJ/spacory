// @vitest-environment jsdom
import { createInitialPlan, type Plan, type Wall } from "@app/schema";
import { useApp } from "@app/store";
import { buildExportSvg } from "@geometry/exportSvg";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectActions } from "./ProjectActions";

const wall = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  id: string,
): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 10 });

/** Two walls sharing a corner — a plan with real geometry, not a lone wall. */
const cornerPlan = (name: string): Plan => ({
  ...createInitialPlan(),
  meta: { ...createInitialPlan().meta, name },
  walls: [wall(0, 0, 400, 0, "w1"), wall(400, 0, 400, 300, "w2")],
});

/** Captures what `downloadBlob` handed to the anchor it clicks. */
type Download = { filename: string; blob: Blob };

function captureDownloads(): Download[] {
  const downloads: Download[] = [];
  const blobsByUrl = new Map<string, Blob>();
  let nextUrl = 0;

  vi.spyOn(URL, "createObjectURL").mockImplementation((obj) => {
    const url = `blob:test/${nextUrl++}`;
    blobsByUrl.set(url, obj as Blob);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    const blob = blobsByUrl.get(this.href);
    if (blob) downloads.push({ filename: this.download, blob });
  });

  return downloads;
}

/** jsdom's `Blob` has no `text()`, so read it the long way round. */
function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

/** Open the Export menu and return its entries, in rendered order. */
function openExportMenu(): HTMLElement[] {
  fireEvent.click(screen.getByRole("button", { name: /Export/ }));
  return screen.getAllByRole("menuitem");
}

describe("ProjectActions — Export menu", () => {
  let downloads: Download[];

  beforeEach(() => {
    downloads = captureDownloads();
    useApp.getState().loadPlan(cornerPlan("My Plan!"));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("offers JSON, PNG and SVG, in that order", () => {
    render(<ProjectActions />);
    expect(openExportMenu().map((item) => item.textContent)).toEqual([
      "JSON",
      "PNG",
      "SVG",
    ]);
  });

  it("downloads the plan's SVG markup as <plan-name>.svg", async () => {
    render(<ProjectActions />);
    const svgEntry = openExportMenu()[2];
    expect(svgEntry.textContent).toBe("SVG");

    fireEvent.click(svgEntry);

    expect(downloads).toHaveLength(1);
    const [download] = downloads;
    // Sanitized from "My Plan!" by the same helper the JSON/PNG entries use.
    expect(download.filename).toBe("My-Plan.svg");
    expect(download.blob.type).toBe("image/svg+xml;charset=utf-8");
    expect(await readBlobText(download.blob)).toBe(
      buildExportSvg(useApp.getState().plan).markup,
    );
  });

  it("closes the menu when the SVG entry is selected", () => {
    render(<ProjectActions />);
    fireEvent.click(openExportMenu()[2]);
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
  });

  it("still rasterizes for PNG rather than saving the SVG markup", () => {
    render(<ProjectActions />);
    fireEvent.click(openExportMenu()[1]);
    // PNG goes through an <img> + <canvas>, which resolves asynchronously and
    // is unsupported in jsdom — the point here is that it did not take the new
    // synchronous SVG path.
    expect(downloads).toHaveLength(0);
  });
});
