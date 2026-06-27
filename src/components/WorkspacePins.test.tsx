import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspacePin, WorkspacePinRect } from "../suggestions/inbox";
import type { TextSuggestion } from "../suggestions/types";
import { WorkspacePins } from "./WorkspacePins";

const item: TextSuggestion = {
  id: "workspace-item",
  dedupeKey: "workspace-item",
  kind: "snippet",
  title: "Keep the core argument visible",
  summary: "A short workspace reference.",
  body: "The full reference content remains outside the document.",
  insertText: "Insertable content.",
  sourceLabels: [],
  createdAt: 1,
};

const pin: WorkspacePin = {
  item,
  pinnedAt: 2,
  pendingInitialPlacement: false,
  x: 100,
  y: 100,
  width: 320,
  height: 240,
  zIndex: 1,
};

function Harness({
  onGeometryChange,
  onRaise,
  onReturnToPins,
}: {
  onGeometryChange: (id: string, rect: WorkspacePinRect) => void;
  onRaise: (id: string) => void;
  onReturnToPins: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={canvasRef}>
      <WorkspacePins
        canvasRef={canvasRef}
        pins={[pin]}
        onGeometryChange={onGeometryChange}
        onRaise={onRaise}
        onReturnToPins={onReturnToPins}
      />
    </div>
  );
}

describe("WorkspacePins", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(700);
  });

  afterEach(() => vi.restoreAllMocks());

  it("renders reference content and returns the item to pins", async () => {
    const onReturnToPins = vi.fn();
    render(
      <Harness
        onGeometryChange={vi.fn()}
        onRaise={vi.fn()}
        onReturnToPins={onReturnToPins}
      />,
    );

    expect(
      await screen.findByRole("region", { name: `Workspace pin: ${item.title}` }),
    ).toBeTruthy();
    expect(screen.getByText(item.body)).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: `Return ${item.title} to pins` }),
    );
    expect(onReturnToPins).toHaveBeenCalledWith(item.id);
  });

  it("supports keyboard movement and resizing", async () => {
    const onGeometryChange = vi.fn();
    const onRaise = vi.fn();
    render(
      <Harness
        onGeometryChange={onGeometryChange}
        onRaise={onRaise}
        onReturnToPins={vi.fn()}
      />,
    );

    const move = await screen.findByRole("button", { name: `Move ${item.title}` });
    fireEvent.keyDown(move, { key: "ArrowRight" });
    await waitFor(() =>
      expect(onGeometryChange).toHaveBeenLastCalledWith(item.id, {
        x: 110,
        y: 100,
        width: 320,
        height: 240,
      }),
    );

    const resize = screen.getByRole("button", { name: `Resize ${item.title}` });
    fireEvent.keyDown(resize, { key: "ArrowDown", shiftKey: true });
    expect(onGeometryChange).toHaveBeenLastCalledWith(item.id, {
      x: 110,
      y: 100,
      width: 320,
      height: 241,
    });
    expect(onRaise).toHaveBeenCalledWith(item.id);
  });

  it("commits pointer dragging when the drag handle is released", async () => {
    const onGeometryChange = vi.fn();
    render(
      <Harness
        onGeometryChange={onGeometryChange}
        onRaise={vi.fn()}
        onReturnToPins={vi.fn()}
      />,
    );

    const move = await screen.findByRole("button", { name: `Move ${item.title}` });
    move.setPointerCapture = vi.fn();
    move.hasPointerCapture = vi.fn(() => false);
    fireEvent.pointerDown(move, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(move, { pointerId: 1, clientX: 140, clientY: 130 });
    fireEvent.pointerUp(move, { pointerId: 1, clientX: 140, clientY: 130 });

    expect(onGeometryChange).toHaveBeenCalledWith(item.id, {
      x: 140,
      y: 130,
      width: 320,
      height: 240,
    });
  });
});
