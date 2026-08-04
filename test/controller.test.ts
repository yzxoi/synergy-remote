import { describe, expect, test } from "bun:test";
import { createActionRunner, createStatusPolling } from "../src/controller";
import type { RemoteAccessStatus } from "../src/types";

const ready: RemoteAccessStatus = {
  provider: "tailscale",
  phase: "ready",
  desiredEnabled: false,
  installed: true,
  loggedIn: true,
  online: true,
};

describe("remote settings controller", () => {
  test("polls status and aborts and clears its timer on cleanup", async () => {
    let callback: (() => void) | undefined;
    let cleared = false;
    const statuses: RemoteAccessStatus[] = [];
    const operations = {
      query: async () => ready,
      command: async () => ready,
    };
    const polling = createStatusPolling({
      operations,
      onStatus: (status) => statuses.push(status),
      onError: () => {},
      setInterval(next) {
        callback = next as () => void;
        return 42 as never;
      },
      clearInterval(timer) {
        cleared = timer === 42;
      },
    });

    polling.start();
    await Bun.sleep(0);
    callback?.();
    await Bun.sleep(0);
    polling.stop();

    expect(statuses).toHaveLength(2);
    expect(cleared).toBe(true);
  });

  test("suppresses duplicate commands while one is running", async () => {
    let release!: () => void;
    let calls = 0;
    const operations = {
      query: async () => ready,
      command: async () => {
        calls += 1;
        await new Promise<void>((resolve) => (release = resolve));
        return ready;
      },
    };
    const runner = createActionRunner({
      operations,
      confirm: async () => true,
      onBusy: () => {},
      onStatus: () => {},
      onError: () => {},
      onLaunched: () => {},
      refresh: async () => {},
    });

    const first = runner.run("remote.enable");
    const second = await runner.run("remote.enable");
    release();

    expect(second).toBe(false);
    expect(await first).toBe(true);
    expect(calls).toBe(1);
  });

  test("does not invoke a command when confirmation is cancelled", async () => {
    let calls = 0;
    const runner = createActionRunner({
      operations: {
        query: async () => ready,
        command: async () => {
          calls += 1;
          return ready;
        },
      },
      confirm: async () => false,
      onBusy: () => {},
      onStatus: () => {},
      onError: () => {},
      onLaunched: () => {},
      refresh: async () => {},
    });

    expect(
      await runner.confirmAndRun("remote.install", {
        title: "Install",
        message: "Confirm",
      }),
    ).toBe(false);
    expect(calls).toBe(0);
  });

  test("suppresses repeated confirmation clicks", async () => {
    let release!: (confirmed: boolean) => void;
    let confirmations = 0;
    const runner = createActionRunner({
      operations: { query: async () => ready, command: async () => ready },
      confirm: async () => {
        confirmations += 1;
        return new Promise<boolean>((resolve) => (release = resolve));
      },
      onBusy: () => {},
      onStatus: () => {},
      onError: () => {},
      onLaunched: () => {},
      refresh: async () => {},
    });

    const first = runner.confirmAndRun("remote.enable", {
      title: "Enable",
      message: "Confirm",
    });
    const second = await runner.confirmAndRun("remote.enable", {
      title: "Enable",
      message: "Confirm",
    });
    release(false);

    expect(second).toBe(false);
    expect(await first).toBe(false);
    expect(confirmations).toBe(1);
  });

  test("reports a polling error and succeeds on retry", async () => {
    let calls = 0;
    const errors: Array<string | undefined> = [];
    const statuses: RemoteAccessStatus[] = [];
    const polling = createStatusPolling({
      operations: {
        query: async () => {
          calls += 1;
          if (calls === 1) throw new Error("daemon unavailable");
          return ready;
        },
        command: async () => ready,
      },
      onStatus: (status) => statuses.push(status),
      onError: (error) => errors.push(error),
    });

    await polling.refresh();
    await polling.refresh();

    expect(errors).toEqual(["daemon unavailable", undefined]);
    expect(statuses).toEqual([ready]);
  });
});
