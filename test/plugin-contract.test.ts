import { describe, expect, test } from "bun:test";
import { compilePluginManifest } from "@ericsanchezok/synergy-plugin";
import plugin from "../src/index";

describe("Synergy Remote plugin contract", () => {
  const manifest = compilePluginManifest(plugin, {
    generation: "contract-test",
    runtime: { entry: "runtime/index.js", sha256: "test" },
    ui: { entry: "ui/index.js", sha256: "test" },
  });

  test("requests only the bounded remote and trusted UI capabilities", () => {
    expect(manifest.capabilities).toEqual([
      { id: "runtime.endpoint.read" },
      { id: "settings.read" },
      { id: "settings.write" },
      { id: "ui.hostActions" },
    ]);
  });

  test("keeps every remote operation UI-only and capability-gated", () => {
    const operations = manifest.contributions.filter(
      (contribution) => contribution.kind === "operation",
    );

    expect(operations.map((operation) => operation.id)).toEqual([
      "remote.status",
      "remote.install",
      "remote.login",
      "remote.enable",
      "remote.disable",
    ]);
    expect(
      operations.every(
        (operation) =>
          operation.expose.length === 1 &&
          operation.expose[0] === "ui" &&
          (operation.id === "remote.login" ||
            operation.requires?.every((capability) =>
              [
                "runtime.endpoint.read",
                "settings.read",
                "settings.write",
              ].includes(capability),
            )),
      ),
    ).toBe(true);
  });

  test("contributes install, Settings, and guarded uninstall lifecycle handlers", () => {
    expect(
      manifest.contributions.find(
        (contribution) => contribution.kind === "lifecycle.install",
      ),
    ).toMatchObject({
      id: "remote.install",
      requires: ["settings.read", "settings.write"],
    });
    expect(
      manifest.contributions.find(
        (contribution) => contribution.kind === "ui.settings",
      ),
    ).toMatchObject({
      id: "remote-access",
      label: "Remote Access",
      group: "Plugins",
    });
    expect(
      manifest.contributions.find(
        (contribution) => contribution.kind === "lifecycle.uninstall",
      ),
    ).toMatchObject({
      id: "remote.cleanup",
      requires: ["settings.read", "settings.write"],
    });
  });
});
