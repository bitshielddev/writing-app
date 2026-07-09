import { describe, expect, it } from "vitest";

import {
  clampWorkspacePinRect,
  createInitialWorkspacePinRect,
  workspacePinRectsEqual,
} from "./geometry";

describe("workspace pin geometry", () => {
  it("enforces minimum size and edge padding", () => {
    expect(
      clampWorkspacePinRect(
        { x: -50, y: 900, width: 100, height: 80 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ x: 16, y: 404, width: 280, height: 180 });
  });

  it("uses the same minimum policy when bounds are smaller than a card", () => {
    expect(
      clampWorkspacePinRect(
        { x: 50, y: 50, width: 500, height: 400 },
        { width: 200, height: 120 },
      ),
    ).toEqual({ x: 16, y: 16, width: 280, height: 180 });
  });

  it("clamps drag and resize changes at the available edges", () => {
    expect(
      clampWorkspacePinRect(
        { x: 700, y: 500, width: 400, height: 300 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ x: 384, y: 284, width: 400, height: 300 });
  });

  it("creates cascaded initial placement through the shared policy", () => {
    expect(
      createInitialWorkspacePinRect({
        preferredSize: { width: 320, height: 240 },
        bounds: { width: 800, height: 600 },
        visibleTop: 20,
        stackIndex: 2,
      }),
    ).toEqual({ x: 408, y: 92, width: 320, height: 240 });
  });

  it("identifies no-op repairs", () => {
    const rect = { x: 16, y: 20, width: 320, height: 240 };
    expect(workspacePinRectsEqual(rect, { ...rect })).toBe(true);
    expect(workspacePinRectsEqual(rect, { ...rect, x: 17 })).toBe(false);
  });
});
