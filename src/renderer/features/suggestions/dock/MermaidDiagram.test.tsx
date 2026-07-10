import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RunOptions } from "mermaid";

import { MermaidDiagram } from "./MermaidDiagram";

const mermaidMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  run: vi.fn(),
}));

vi.mock("mermaid", () => ({
  default: mermaidMocks,
}));

/**
 * What: performs the render host step for this file's workflow.
 *
 * Why: the test needs a focused helper so assertions stay about the behavior under test.
 * Called when: used by MermaidDiagram when that path needs this behavior.
 */
function renderHost(options: RunOptions | undefined) {
  const host = options?.nodes?.[0];
  if (!(host instanceof HTMLElement)) {
    throw new Error("Expected Mermaid to receive an HTML render host");
  }
  return host;
}

/**
 * What: performs the append rendered svg step for this file's workflow.
 *
 * Why: the test needs a focused helper so assertions stay about the behavior under test.
 * Called when: used by MermaidDiagram when that path needs this behavior.
 */
function appendRenderedSvg(host: HTMLElement) {
  host.replaceChildren(
    document.createElementNS("http://www.w3.org/2000/svg", "svg"),
  );
}

beforeEach(() => {
  mermaidMocks.run.mockReset();
});

describe("MermaidDiagram", () => {
  it("passes source text to Mermaid in strict mode and exposes the rendered diagram", async () => {
    const source = "mindmap\n  root((Draft))";
    let receivedSource: string | null = null;

    mermaidMocks.run.mockImplementation(async (options: RunOptions) => {
      const host = renderHost(options);
      receivedSource = host.textContent;
      appendRenderedSvg(host);
    });

    render(
      <MermaidDiagram
        source={source}
        title="Draft map"
        description="A map of the draft"
      />,
    );

    expect(screen.getByRole("status").textContent).toContain(
      "Rendering diagram",
    );
    expect(
      await screen.findByRole("img", {
        name: "Draft map. A map of the draft",
      }),
    ).toBeTruthy();
    expect(receivedSource).toBe(source);
    expect(mermaidMocks.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: "strict",
        startOnLoad: false,
        suppressErrorRendering: true,
      }),
    );
  });

  it("keeps HTML-like Mermaid source as text at the application boundary", async () => {
    const source = 'mindmap\n  root["<img src=x onerror=alert(1)>"]';
    let receivedSource: string | null = null;
    let sourceCreatedElements = true;

    mermaidMocks.run.mockImplementation(async (options: RunOptions) => {
      const host = renderHost(options);
      receivedSource = host.textContent;
      sourceCreatedElements = host.children.length > 0;
      appendRenderedSvg(host);
    });

    render(
      <MermaidDiagram
        source={source}
        title="Untrusted map"
        description="Untrusted source test"
      />,
    );

    await screen.findByRole("img", { name: /Untrusted map/ });
    expect(receivedSource).toBe(source);
    expect(sourceCreatedElements).toBe(false);
  });

  it("isolates concurrent diagram renders while initializing Mermaid once", async () => {
    const firstSource = "mindmap\n  root((First))";
    const secondSource = "mindmap\n  root((Second))";
    const pendingRuns: Array<{
      host: HTMLElement;
      resolve: () => void;
      reject: (error: Error) => void;
    }> = [];

    mermaidMocks.run.mockImplementation(
      (options: RunOptions) =>
        new Promise<void>((resolve, reject) => {
          pendingRuns.push({
            host: renderHost(options),
            resolve,
            reject,
          });
        }),
    );

    render(
      <>
        <MermaidDiagram
          source={firstSource}
          title="First map"
          description="First description"
        />
        <MermaidDiagram
          source={secondSource}
          title="Second map"
          description="Second description"
        />
      </>,
    );

    await waitFor(() => expect(pendingRuns).toHaveLength(2));
    const firstRun = pendingRuns.find(
      ({ host }) => host.textContent === firstSource,
    );
    const secondRun = pendingRuns.find(
      ({ host }) => host.textContent === secondSource,
    );

    expect(firstRun).toBeDefined();
    expect(secondRun).toBeDefined();
    expect(firstRun?.host).not.toBe(secondRun?.host);
    expect(mermaidMocks.initialize).toHaveBeenCalledTimes(1);

    appendRenderedSvg(secondRun!.host);
    await act(async () => secondRun!.resolve());

    expect(
      screen.getByRole("img", { name: "Second map. Second description" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("img", { name: "First map. First description" }),
    ).toBeNull();

    await act(async () => firstRun!.reject(new Error("First render failed")));

    expect(await screen.findByText("Diagram unavailable")).toBeTruthy();
    expect(
      screen.getByRole("img", { name: "Second map. Second description" }),
    ).toBeTruthy();
  });

  it("shows the accessible fallback when Mermaid rejects the source", async () => {
    mermaidMocks.run.mockRejectedValueOnce(new Error("Invalid Mermaid"));

    render(
      <MermaidDiagram
        source="not a diagram"
        title="Broken map"
        description="The intended relationships"
      />,
    );

    await screen.findByText("Diagram unavailable");
    const fallback = screen.getByRole("status");
    expect(fallback.textContent).toContain("Diagram unavailable");
    expect(fallback.textContent).toContain("The intended relationships");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("remounts for changed source and ignores stale render completion", async () => {
    const completions: Array<() => void> = [];
    const receivedSources: Array<string | null> = [];

    mermaidMocks.run.mockImplementation(
      (options: RunOptions) =>
        new Promise<void>((resolve) => {
          receivedSources.push(renderHost(options).textContent);
          completions.push(resolve);
        }),
    );

    const { rerender } = render(
      <MermaidDiagram
        source={"mindmap\n  root((First))"}
        title="First map"
        description="First description"
      />,
    );
    await waitFor(() => expect(completions).toHaveLength(1));

    rerender(
      <MermaidDiagram
        source={"mindmap\n  root((Second))"}
        title="Second map"
        description="Second description"
      />,
    );
    await waitFor(() => expect(completions).toHaveLength(2));

    await act(async () => completions[0]?.());
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain(
      "Rendering diagram",
    );

    await act(async () => completions[1]?.());
    expect(
      screen.getByRole("img", { name: "Second map. Second description" }),
    ).toBeTruthy();
    expect(receivedSources).toEqual([
      "mindmap\n  root((First))",
      "mindmap\n  root((Second))",
    ]);
  });
});
