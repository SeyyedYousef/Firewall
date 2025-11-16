// @vitest-environment jsdom

import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import type { ReactNode } from "react";

vi.mock("@tonconnect/ui-react", () => ({
  TonConnectUIProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("lottie-react", () => ({
  __esModule: true,
  default: () => null,
}));

let RootComponent: typeof import("../src/components/Root")["Root"];

beforeAll(async () => {
  const matchMediaMock = vi.fn().mockReturnValue({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  });
  vi.stubGlobal("matchMedia", matchMediaMock);

  vi.stubGlobal("customElements", {
    define: vi.fn(),
    get: vi.fn(),
  });

  const canvasContextStub = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    drawImage: vi.fn(),
    measureText: vi.fn().mockReturnValue({ width: 0 }),
    globalCompositeOperation: "source-over",
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(window.HTMLCanvasElement.prototype, "getContext").mockReturnValue(canvasContextStub);

  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(cb, 0));
  window.requestAnimationFrame = globalThis.requestAnimationFrame;

  ({ Root: RootComponent } = await import("../src/components/Root"));
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

test("Root renders without throwing synchronously", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = createRoot(container);

  await act(async () => {
    root.render(<RootComponent />);
    await Promise.resolve();
  });

  root.unmount();
  expect(container.innerHTML).not.toEqual("");
});
