// @vitest-environment jsdom
import { serializePlan } from "@app/io";
import { HISTORY_STORAGE_KEY } from "@app/persistence";
import { createInitialPlan, type Plan, type Wall } from "@app/schema";
import { useApp } from "@app/store";
import { FloorPlan } from "@features/canvas/FloorPlan";
import { buildExportSvg } from "@geometry/exportSvg";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectActions } from "./ProjectActions";

const wall = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  id: string,
): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 10 });

const roomPlan = (): Plan => ({
  ...createInitialPlan(),
  meta: { ...createInitialPlan().meta, name: "My Plan!" },
  walls: [
    wall(0, 0, 400, 0, "w1"),
    wall(400, 0, 400, 300, "w2"),
    wall(400, 300, 0, 300, "w3"),
    wall(0, 300, 0, 0, "w4"),
  ],
  items: [
    {
      id: "door",
      type: "door",
      wallAttach: { wallId: "w1", offset: 100, length: 80 },
      thickness: 10,
      props: { hingeEdge: "start", swingSide: "outside" },
    },
  ],
  roomNames: [{ anchor: { x: 200, y: 150 }, name: "Living room" }],
  labels: [
    {
      id: "terrace",
      position: { x: -300, y: 400 },
      text: "Terrace & 茶室 <🌿>",
    },
  ],
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

function openImageDialog(): HTMLElement {
  openExportMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Image…" }));
  return screen.getByRole("dialog", { name: "Export image" });
}

function previewMarkup(dialog: HTMLElement): string {
  const image = within(dialog).getByRole("img", { name: "Floor plan preview" });
  return decodeURIComponent(image.getAttribute("src")!.split(",")[1]);
}

function mockPngRasterizer() {
  const drawImage =
    vi.fn<
      (
        image: HTMLImageElement,
        x: number,
        y: number,
        width: number,
        height: number,
      ) => void
    >();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback, type) => callback(new Blob([], { type })),
  );
  vi.spyOn(HTMLImageElement.prototype, "src", "set").mockImplementation(
    function (this: HTMLImageElement) {
      this.dispatchEvent(new Event("load"));
    },
  );
  return drawImage;
}

class TestClipboardItem {
  constructor(readonly data: Record<string, Promise<Blob>>) {}
}

function mockClipboard(write: (items: TestClipboardItem[]) => Promise<void>) {
  vi.stubGlobal("ClipboardItem", TestClipboardItem);
  vi.stubGlobal("navigator", { clipboard: { write } });
}

// jsdom omits the native modal methods. Model the open state; Escape's cancel
// event is dispatched explicitly in the dialog test.
HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
HTMLDialogElement.prototype.close = function () {
  this.open = false;
};

describe("ProjectActions — Export menu", () => {
  let downloads: Download[];

  beforeEach(() => {
    downloads = captureDownloads();
    useApp.getState().loadPlan(roomPlan());
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("offers one image entry and downloads JSON directly", async () => {
    render(<ProjectActions />);
    expect(openExportMenu().map((item) => item.textContent)).toEqual([
      "Image…",
      "JSON",
    ]);

    fireEvent.click(screen.getByRole("menuitem", { name: "JSON" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(downloads).toHaveLength(1);
    expect(downloads[0].filename).toBe("My-Plan.json");
    expect(downloads[0].blob.type).toBe("application/json");
    expect(await readBlobText(downloads[0].blob)).toBe(
      serializePlan(useApp.getState().plan),
    );
  });

  it("uses floor-plan as the filename for every export of an untitled plan", async () => {
    useApp.getState().loadPlan(createInitialPlan());
    const plan = useApp.getState().plan;
    mockPngRasterizer();
    render(<ProjectActions />);

    openExportMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "JSON" }));

    const controls = within(openImageDialog());
    fireEvent.click(controls.getByRole("button", { name: "Download SVG" }));
    fireEvent.click(controls.getByRole("button", { name: "Download PNG" }));

    await waitFor(() =>
      expect(downloads.map(({ filename }) => filename)).toEqual([
        "floor-plan.json",
        "floor-plan.svg",
        "floor-plan.png",
      ]),
    );
    expect(await readBlobText(downloads[0].blob)).toBe(serializePlan(plan));
    expect(useApp.getState().plan).toBe(plan);
  });

  it.each([
    true,
    false,
  ])("disables PNG during preparation and resets after encoding (success: %s)", async (success) => {
    mockPngRasterizer();
    const encode = vi
      .mocked(HTMLCanvasElement.prototype.toBlob)
      .mockImplementation(() => {});
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    render(<ProjectActions />);
    const controls = within(openImageDialog());
    const button = controls.getByRole<HTMLButtonElement>("button", {
      name: "Download PNG",
    });
    const iconWidth = button.querySelector("svg")?.getAttribute("width");

    await act(async () => {
      fireEvent.click(button);
    });
    expect(button.textContent).toBe("PNG");
    expect(
      button.querySelector(".lucide-loader-circle")?.getAttribute("width"),
    ).toBe(iconWidth);
    expect(button.disabled).toBe(true);
    expect(
      controls.getByRole("status", { name: "PNG download" }).textContent,
    ).toBe("Preparing PNG…");
    expect(downloads).toHaveLength(0);
    fireEvent.click(button);

    const png = new Blob([], { type: "image/png" });
    const [[finishEncoding]] = encode.mock.calls;
    await act(async () => finishEncoding(success ? png : null));

    expect(encode).toHaveBeenCalledOnce();
    expect(button.disabled).toBe(false);
    expect(button.querySelector(".lucide-download")).not.toBeNull();
    if (success) {
      expect(downloads).toEqual([{ filename: "My-Plan.png", blob: png }]);
      expect(alert).not.toHaveBeenCalled();
    } else {
      expect(downloads).toHaveLength(0);
      expect(alert).toHaveBeenCalledWith("Could not export PNG.");
    }
  });

  it.each([
    { wallLengths: true, roomAreas: true },
    { wallLengths: true, roomAreas: false },
    { wallLengths: false, roomAreas: true },
    { wallLengths: false, roomAreas: false },
  ])("shares the preview SVG with both downloads (lengths $wallLengths, areas $roomAreas)", async ({
    wallLengths,
    roomAreas,
  }) => {
    const drawImage = mockPngRasterizer();
    render(<ProjectActions />);
    const dialog = openImageDialog();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(downloads).toHaveLength(0);

    const lengths = within(dialog).getByRole<HTMLInputElement>("checkbox", {
      name: "Wall lengths",
    });
    const areas = within(dialog).getByRole<HTMLInputElement>("checkbox", {
      name: "Room areas",
    });
    expect(lengths.checked).toBe(true);
    expect(areas.checked).toBe(true);
    expect(previewMarkup(dialog)).toBe(
      buildExportSvg(useApp.getState().plan).markup,
    );

    // The label text is part of the touch target.
    if (!wallLengths) fireEvent.click(within(dialog).getByText("Wall lengths"));
    if (!roomAreas) fireEvent.click(within(dialog).getByText("Room areas"));
    expect(lengths.checked).toBe(wallLengths);
    expect(areas.checked).toBe(roomAreas);

    const markup = previewMarkup(dialog);
    const preview = new DOMParser().parseFromString(markup, "image/svg+xml");
    expect(
      preview.querySelectorAll('[data-layer="dimensions"] text'),
    ).toHaveLength(wallLengths ? 4 : 0);
    const roomText = Array.from(
      preview.querySelectorAll('[data-layer="room-areas"] text'),
      (node) => node.textContent,
    );
    expect(roomText).toEqual(
      roomAreas ? ["Living room", "12 m²"] : ["Living room"],
    );
    expect(
      preview.querySelectorAll('[data-layer="walls"] polygon'),
    ).toHaveLength(4);
    expect(preview.querySelector('[data-layer="items"] path')).not.toBeNull();
    expect(
      preview.querySelector('[data-layer="plan-labels"] text')?.textContent,
    ).toBe("Terrace & 茶室 <🌿>");

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Download SVG" }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Download PNG" }),
    );

    await waitFor(() =>
      expect(
        downloads.map(({ filename, blob }) => [filename, blob.type]),
      ).toEqual([
        ["My-Plan.svg", "image/svg+xml;charset=utf-8"],
        ["My-Plan.png", "image/png"],
      ]),
    );
    expect(await readBlobText(downloads[0].blob)).toBe(markup);
    const [pngSource] = vi.mocked(URL.createObjectURL).mock.calls[1];
    expect(await readBlobText(pngSource as Blob)).toBe(markup);
    expect(drawImage).toHaveBeenCalledOnce();
  });

  it.each([
    true,
    false,
  ])("uses the preview PNG and reports the write result (allowed: %s)", async (allowed) => {
    mockPngRasterizer();
    const write = vi.fn(async ([_item]: TestClipboardItem[]) => {
      if (!allowed) throw new DOMException("Denied", "NotAllowedError");
    });
    mockClipboard(write);
    render(<ProjectActions />);
    const dialog = openImageDialog();
    const controls = within(dialog);
    fireEvent.click(controls.getByRole("checkbox", { name: "Wall lengths" }));

    const button = controls.getByRole<HTMLButtonElement>("button", {
      name: "Copy image",
    });
    fireEvent.click(button);

    expect(write).toHaveBeenCalledOnce();
    const [[[item]]] = write.mock.calls;
    await expect(item.data["image/png"]).resolves.toMatchObject({
      type: "image/png",
    });
    const [pngSource] = vi.mocked(URL.createObjectURL).mock.calls[0];
    expect(await readBlobText(pngSource as Blob)).toBe(previewMarkup(dialog));
    await waitFor(() =>
      expect(
        (allowed
          ? controls.getByRole("status", { name: "Image copy" })
          : controls.getByRole("alert")
        ).textContent,
      ).toBe(
        allowed
          ? "Image copied."
          : "Couldn’t copy. Try again or download the PNG.",
      ),
    );
    expect(button.querySelector('[data-visible="true"]')?.textContent).toBe(
      allowed ? "Copied" : "Copy image",
    );
    expect(button.disabled).toBe(false);
    expect(downloads).toHaveLength(0);
  });

  it("shows progress immediately and disables copy until the write settles", async () => {
    vi.useFakeTimers();
    mockPngRasterizer();
    let finishWrite!: () => void;
    const clipboardWrite = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    const write = vi.fn(() => clipboardWrite);
    mockClipboard(write);
    render(<ProjectActions />);
    const controls = within(openImageDialog());
    const button = controls.getByRole<HTMLButtonElement>("button", {
      name: "Copy image",
    });
    const visibleContent = () => button.querySelector('[data-visible="true"]');
    const iconWidth = visibleContent()
      ?.querySelector("svg")
      ?.getAttribute("width");
    fireEvent.click(button);
    expect(visibleContent()?.textContent).toBe("Copy image");
    expect(
      visibleContent()
        ?.querySelector(".lucide-loader-circle")
        ?.getAttribute("width"),
    ).toBe(iconWidth);
    expect(
      controls.getByRole("status", { name: "Image copy" }).textContent,
    ).toBe("Copying image…");
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(write).toHaveBeenCalledOnce();

    await act(async () => finishWrite());
    expect(visibleContent()?.textContent).toBe("Copied");
    expect(visibleContent()?.querySelector(".lucide-check")).not.toBeNull();
    expect(button.disabled).toBe(false);

    act(() => vi.advanceTimersByTime(1999));
    expect(visibleContent()?.textContent).toBe("Copied");
    act(() => vi.advanceTimersByTime(1));
    expect(visibleContent()?.textContent).toBe("Copy image");
    expect(visibleContent()?.querySelector(".lucide-copy")).not.toBeNull();
  });

  it("keeps the same light plan preview across editor themes", () => {
    const { themeMode, setThemeMode } = useApp.getState();
    try {
      setThemeMode("dark");
      render(<ProjectActions />);
      const darkPreview = openImageDialog();
      const markup = previewMarkup(darkPreview);
      const svg = new DOMParser().parseFromString(markup, "image/svg+xml");
      expect(svg.querySelector("svg > rect")?.getAttribute("fill")).toBe(
        "#ffffff",
      );
      fireEvent.click(
        within(darkPreview).getByRole("button", {
          name: "Close export dialog",
        }),
      );

      setThemeMode("light");
      expect(previewMarkup(openImageDialog())).toBe(markup);
    } finally {
      setThemeMode(themeMode);
    }
  });

  it("blocks editor shortcuts when focus falls back to the document during export", () => {
    useApp.getState().selectWall("w1");
    render(
      <>
        <ProjectActions />
        <FloorPlan />
      </>,
    );
    const dialog = openImageDialog();
    const before = useApp.getState().plan;

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(useApp.getState().plan).toBe(before);

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Close export dialog" }),
    );
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(useApp.getState().plan.walls[0].a.x).toBe(before.meta.gridSize);
  });

  it.each([
    "Close",
    "Escape",
  ])("closes with %s and starts with both measurements on next time", (action) => {
    const state = useApp.getState();
    state.setMeasurementSystem("imperial");
    state.selectWall("w1");
    const before = useApp.getState();
    const history = localStorage.getItem(HISTORY_STORAGE_KEY);
    expect(history).not.toBeNull();

    render(<ProjectActions />);
    const dialog = openImageDialog();
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: "Wall lengths" }),
    );
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: "Room areas" }),
    );

    if (action === "Escape") {
      const editorShortcut = vi.fn();
      window.addEventListener("keydown", editorShortcut, { once: true });
      try {
        const button = within(dialog).getByRole("button", {
          name: "Download PNG",
        });
        expect(fireEvent.keyDown(button, { key: "Escape" })).toBe(true);
        expect(editorShortcut).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener("keydown", editorShortcut);
      }
      fireEvent(dialog, new Event("cancel", { cancelable: true }));
    } else {
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Close export dialog" }),
      );
    }

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(downloads).toHaveLength(0);
    expect(useApp.getState()).toBe(before);
    expect(localStorage.getItem(HISTORY_STORAGE_KEY)).toBe(history);
    const reopened = openImageDialog();
    expect(
      within(reopened).getByRole<HTMLInputElement>("checkbox", {
        name: "Wall lengths",
      }).checked,
    ).toBe(true);
    expect(
      within(reopened).getByRole<HTMLInputElement>("checkbox", {
        name: "Room areas",
      }).checked,
    ).toBe(true);
  });

  it.each([
    { description: "at the normal resolution", x: -300, y: 400, limit: "none" },
    {
      description: "within the canvas area limit",
      x: 9500,
      y: 9500,
      limit: "area",
    },
    {
      description: "within the canvas side limit",
      x: 9500,
      y: 0,
      limit: "side",
    },
  ])("rasterizes the entire plan with an outdoor label $description", async ({
    x,
    y,
    limit,
  }) => {
    const plan = roomPlan();
    const label = plan.labels![0];
    plan.labels = [{ ...label, position: { x, y } }];
    useApp.getState().loadPlan(plan);

    const drawImage = mockPngRasterizer();
    render(<ProjectActions />);
    const dialog = openImageDialog();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Download PNG" }),
    );
    const expected = buildExportSvg(plan);
    const [svg] = vi.mocked(URL.createObjectURL).mock.calls[0];
    const markup = await readBlobText(svg as Blob);
    const svgDoc = new DOMParser().parseFromString(markup, "image/svg+xml");
    expect(
      svgDoc.querySelector('[data-layer="plan-labels"] text')?.textContent,
    ).toBe(label.text);
    expect(markup).toBe(expected.markup);
    const [[, , , width, height]] = drawImage.mock.calls;
    expect(drawImage).toHaveBeenCalledWith(
      expect.any(HTMLImageElement),
      0,
      0,
      width,
      height,
    );
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    expect(
      Math.abs(height - (width * expected.height) / expected.width),
    ).toBeLessThan(2);
    expect(Math.max(width, height)).toBeLessThanOrEqual(8192);
    expect(width * height).toBeLessThanOrEqual(4096 ** 2);
    if (limit === "none") {
      expect(width).toBe(Math.round(expected.width * 2));
      expect(height).toBe(Math.round(expected.height * 2));
    } else if (limit === "area") {
      expect(width * height).toBeGreaterThan(16_000_000);
    } else {
      expect(width).toBe(8192);
    }
    expect(downloads).toHaveLength(1);
    expect(downloads[0].filename).toBe("My-Plan.png");
    expect(downloads[0].blob.type).toBe("image/png");
  });
});
