import { describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { startTui, type RenderTui } from "./start-tui.js";
import type { SubmitPromptHandler } from "./tui-port.js";

describe("startTui", () => {
  it("renders <App onSubmit={onSubmit} /> via the injected renderer and returns its instance", () => {
    const onSubmit: SubmitPromptHandler = vi.fn();
    const fakeInstance = { unmount: vi.fn(), waitUntilExit: vi.fn().mockResolvedValue(undefined) };
    const renderTui: RenderTui = vi.fn().mockReturnValue(fakeInstance);

    const instance = startTui(onSubmit, renderTui);

    expect(renderTui).toHaveBeenCalledTimes(1);
    const [tree] = vi.mocked(renderTui).mock.calls[0]!;
    expect(tree.type).toBe(App);
    expect(tree.props.onSubmit).toBe(onSubmit);
    expect(instance).toBe(fakeInstance);
  });
});
