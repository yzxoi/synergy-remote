import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RemoteRuntimeController, type RuntimeTimers } from "../src/runtime";
import { RemoteStateStore } from "../src/state";
import type { TailscaleAdapter } from "../src/tailscale/system";

describe("RemoteRuntimeController", () => {
  test("starts retrying at five seconds and cancels the owned timer on stop", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "synergy-remote-tailscale-runtime-"),
    );
    const store = new RemoteStateStore(path.join(directory, "state.json"));
    await store.write({ enabled: true, installAttempted: true });
    const adapter: TailscaleAdapter = {
      platform: "linux",
      executable: async () => "/usr/bin/tailscale",
      install: async () => ({ launched: true, mode: "automatic" }),
      login: async () => ({ launched: true }),
      async run(args) {
        if (args[0] === "status") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({ BackendState: "Running" }),
            stderr: "",
          };
        }
        if (args[0] === "version")
          return { exitCode: 0, stdout: "1.98.0", stderr: "" };
        if (
          args[0] === "serve" &&
          (args[1] === "status" || args[1] === "get-config")
        ) {
          return {
            exitCode: 0,
            stdout: JSON.stringify({ Web: {} }),
            stderr: "",
          };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };
    const scheduled: Array<{ delayMs: number; cancelled: boolean }> = [];
    const timers: RuntimeTimers = {
      set(_callback, delayMs) {
        const item = { delayMs, cancelled: false };
        scheduled.push(item);
        return { cancel: () => (item.cancelled = true) };
      },
    };
    const controller = new RemoteRuntimeController(store, adapter, timers);
    try {
      await controller.start({
        url: "http://127.0.0.1:4096/host-connection/gateway",
        generation: "one",
      });
      expect(scheduled.at(-1)?.delayMs).toBe(5_000);
      controller.stop();
      expect(scheduled.at(-1)?.cancelled).toBe(true);
    } finally {
      controller.stop();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});

describe("RemoteRuntimeController endpoint refresh", () => {
  test("re-resolves the endpoint on each tick and repoints Serve", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "synergy-remote-tailscale-runtime-"),
    );
    const store = new RemoteStateStore(path.join(directory, "state.json"));
    const oldTarget = "http://127.0.0.1:4096/host-connection/gateway";
    const newTarget = "http://127.0.0.1:54641/host-connection/gateway";
    const oldFingerprint = createHash("sha256").update(oldTarget).digest("hex");
    await store.write({
      enabled: true,
      httpsPort: 443,
      installAttempted: true,
      lastTargetFingerprint: oldFingerprint,
    });
    const commands: string[][] = [];
    const adapter: TailscaleAdapter = {
      platform: "linux",
      executable: async () => "/usr/bin/tailscale",
      install: async () => ({ launched: true, mode: "automatic" }),
      login: async () => ({ launched: true }),
      async run(args) {
        commands.push(args);
        if (args[0] === "status") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              BackendState: "Running",
              Self: { HostName: "host", DNSName: "host.example.ts.net." },
              CurrentTailnet: { Name: "example" },
            }),
            stderr: "",
          };
        }
        if (args[0] === "version")
          return { exitCode: 0, stdout: "1.98.0", stderr: "" };
        if (
          args[0] === "serve" &&
          (args[1] === "status" || args[1] === "get-config")
        ) {
          // Serve still points at the OLD target after a Synergy restart.
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              Web: {
                "host:443": { Handlers: { "/": { Proxy: oldTarget } } },
              },
            }),
            stderr: "",
          };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };
    const scheduled: Array<{ cancelled: boolean }> = [];
    const timers: RuntimeTimers = {
      set(_callback, _delayMs) {
        const item = { cancelled: false };
        scheduled.push(item);
        return { cancel: () => (item.cancelled = true) };
      },
    };
    const controller = new RemoteRuntimeController(store, adapter, timers);
    try {
      // The runtime starts with a stale cached endpoint, but the provider
      // resolves the CURRENT endpoint on every tick.
      controller.setEndpointProvider(async () => ({
        url: newTarget,
        generation: "two",
      }));
      await controller.start({ url: oldTarget, generation: "one" });
      expect(
        commands.some(
          (args) =>
            args[0] === "serve" &&
            args.includes("--bg") &&
            args.includes(`--https=443`) &&
            args.includes(newTarget),
        ),
      ).toBe(true);
    } finally {
      controller.stop();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
