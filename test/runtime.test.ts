import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RemoteRuntimeController, type RuntimeTimers } from "../src/runtime";
import { RemoteStateStore } from "../src/state";
import type { TailscaleAdapter } from "../src/tailscale/system";

describe("RemoteRuntimeController", () => {
  test("starts retrying at five seconds and cancels the owned timer on stop", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "synergy-remote-runtime-"),
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
        url: "http://127.0.0.1:4096",
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
