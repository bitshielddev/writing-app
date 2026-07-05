import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

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

  it("commits a cancelled pointer operation exactly once", async () => {
    const onGeometryChange = vi.fn();
    render(
      <Harness
        onGeometryChange={onGeometryChange}
        onRaise={vi.fn()}
        onReturnToPins={vi.fn()}
      />,
    );

    const resize = await screen.findByRole("button", {
      name: `Resize ${item.title}`,
    });
    resize.setPointerCapture = vi.fn();
    resize.hasPointerCapture = vi.fn(() => false);
    fireEvent.pointerDown(resize, { pointerId: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(resize, { pointerId: 2, clientX: 120, clientY: 130 });
    fireEvent.pointerCancel(resize, { pointerId: 2 });
    fireEvent.pointerUp(resize, { pointerId: 2 });

    expect(onGeometryChange).toHaveBeenCalledTimes(1);
    expect(onGeometryChange).toHaveBeenCalledWith(item.id, {
      x: 100,
      y: 100,
      width: 340,
      height: 270,
    });
  });

  it("batches repairs for every out-of-range card after bounds change", async () => {
    let width = 800;
    let height = 700;
    vi.restoreAllMocks();
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
      () => width,
    );
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
      () => height,
    );
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    let notifyResize = () => {};
    class ResizeObserverHarness {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = () => callback([], this);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverHarness);
    const onGeometryChange = vi.fn();

    function MultiplePinsHarness() {
      const canvasRef = useRef<HTMLDivElement>(null);
      const secondPin: WorkspacePin = {
        ...pin,
        item: { ...item, id: "workspace-item-2", dedupeKey: "workspace-item-2" },
        x: 450,
        y: 400,
      };
      return (
        <div ref={canvasRef}>
          <WorkspacePins
            canvasRef={canvasRef}
            pins={[{ ...pin, x: 300, y: 300 }, secondPin]}
            onGeometryChange={onGeometryChange}
            onRaise={vi.fn()}
            onReturnToPins={vi.fn()}
          />
        </div>
      );
    }

    render(<MultiplePinsHarness />);
    expect(
      await screen.findAllByRole("region", {
        name: `Workspace pin: ${item.title}`,
      }),
    ).toHaveLength(2);
    onGeometryChange.mockClear();
    width = 450;
    height = 400;
    act(() => notifyResize());

    await waitFor(() => expect(onGeometryChange).toHaveBeenCalledTimes(2));
    expect(onGeometryChange.mock.calls.map(([id]) => id)).toEqual([
      item.id,
      "workspace-item-2",
    ]);
  });
});
