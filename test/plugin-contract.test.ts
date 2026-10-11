import { describe, expect, spyOn, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  HostConnectionHostService,
  PluginInvocationContext,
} from "@ericsanchezok/synergy-plugin";
import { remoteRuntime } from "../src/runtime";
import { RemoteStateStore } from "../src/state";
import { TailscaleManager } from "../src/tailscale/manager";
import { compilePluginManifest } from "@ericsanchezok/synergy-plugin";
import plugin, { StatusSchema } from "../src/index";

describe("Synergy Remote plugin contract", () => {
  const manifest = compilePluginManifest(plugin, {
    generation: "contract-test",
    runtime: { entry: "runtime/index.js", sha256: "test" },
    ui: { entry: "ui/index.js", sha256: "test" },
  });

  test("requests only the bounded remote and trusted UI capabilities", () => {
    expect(manifest.capabilities).toEqual([
      { id: "runtime.endpoint.read" },
      { id: "host.connection.manage" },
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
      "remote.devices",
      "remote.invite",
      "remote.pair",
      "remote.approve",
      "remote.finish",
      "remote.revoke",
    ]);
    expect(
      operations.every(
        (operation) =>
          operation.expose.length === 1 &&
          operation.expose[0] === "ui" &&
          (operation.id === "remote.login" ||
            operation.requires?.every((capability) =>
              [
                "host.connection.manage",
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
      requires: ["host.connection.manage", "settings.read", "settings.write"],
    });
  });
});

test("status schema carries install progress fields", () => {
  const status = StatusSchema.parse({
    provider: "tailscale",
    phase: "installing",
    desiredEnabled: false,
    installed: false,
    loggedIn: false,
    online: false,
    installAttempted: true,
  });
  expect(status.phase).toBe("installing");
  expect(status.installAttempted).toBe(true);
});

test("a saved enable intent does not activate an unavailable gateway", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "synergy-remote-gateway-"),
  );
  const store = new RemoteStateStore(path.join(directory, "state.json"));
  await store.write({ enabled: true, installAttempted: true });
  const manager = new TailscaleManager({
    state: store,
    endpoint: () => ({
      url: "http://127.0.0.1:4096/host-connection/gateway",
      generation: "fixture",
    }),
    adapter: {
      platform: "linux",
      executable: async () => undefined,
      install: async () => ({ launched: false, mode: "guided" }),
      login: async () => ({ launched: false }),
      run: async () => {
        throw new Error("Tailscale is absent");
      },
    },
  });
  const read = spyOn(remoteRuntime.state, "read").mockImplementation(() =>
    store.read(),
  );
  const importing = spyOn(
    remoteRuntime.state,
    "importSettings",
  ).mockImplementation((value) => store.importSettings(value));
  const selection = spyOn(remoteRuntime, "manager").mockReturnValue(manager);
  const configurations: Array<
    Parameters<HostConnectionHostService["configure"]>[0]
  > = [];
  const context = {
    settings: { get: async () => ({}), replace: async () => {} },
    hostConnection: {
      endpoint: async () => ({
        url: "http://127.0.0.1:4096/host-connection/gateway",
        generation: "fixture",
      }),
      configure: async (
        value: Parameters<HostConnectionHostService["configure"]>[0],
      ) => {
        configurations.push(value);
      },
    },
  } as unknown as PluginInvocationContext;
  try {
    const contribution = plugin.contributions.find(
      (value) => value.kind === "operation" && value.id === "remote.status",
    );
    if (contribution?.kind !== "operation")
      throw new Error("Missing status operation");
    const status = await contribution.handler({}, context);
    expect(status).toMatchObject({ installed: false, desiredEnabled: true });
    expect(configurations).toEqual([
      { enabled: false, name: "Synergy", url: undefined },
    ]);
    expect((await store.read()).enabled).toBe(true);
  } finally {
    read.mockRestore();
    importing.mockRestore();
    selection.mockRestore();
    remoteRuntime.stop();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
