import { describe, expect, test } from "bun:test";
import {
  canEnable,
  copy,
  installAction,
  localeFromLanguage,
  needsCustomPort,
  phaseTone,
  setupSteps,
  validCustomPort,
} from "../src/view-model";
import type { RemoteAccessStatus } from "../src/types";

const ready: RemoteAccessStatus = {
  provider: "tailscale",
  phase: "ready",
  desiredEnabled: false,
  installed: true,
  loggedIn: true,
  online: true,
  installAttempted: true,
};

describe("remote settings view model", () => {
  test("selects Chinese copy for Chinese locales", () => {
    expect(localeFromLanguage("zh-CN")).toBe("zh-CN");
    expect(localeFromLanguage("en-US")).toBe("en");
  });

  test("enables only after Tailscale is installed, signed in, and online", () => {
    expect(canEnable(ready)).toBe(true);
    expect(canEnable({ ...ready, phase: "offline", online: false })).toBe(
      false,
    );
  });

  test("asks for a custom port only after both preferred ports conflict", () => {
    expect(
      needsCustomPort({
        ...ready,
        phase: "conflict",
        conflictPorts: [443, 8443],
      }),
    ).toBe(true);
    expect(
      needsCustomPort({ ...ready, phase: "conflict", conflictPorts: [443] }),
    ).toBe(false);
  });

  test("accepts only the supported custom HTTPS port range", () => {
    expect(validCustomPort("1024")).toBe(true);
    expect(validCustomPort("65535")).toBe(true);
    expect(validCustomPort("443")).toBe(false);
    expect(validCustomPort("65536")).toBe(false);
    expect(validCustomPort("not-a-port")).toBe(false);
  });

  test("offers install, waiting, or nothing based on install state", () => {
    expect(
      installAction({
        ...ready,
        phase: "not_installed",
        installed: false,
        installAttempted: false,
      }),
    ).toBe("install");
    expect(
      installAction({
        ...ready,
        phase: "installing",
        installed: false,
        installAttempted: true,
      }),
    ).toBe("waiting");
    expect(installAction(ready)).toBe("none");
  });

  test("marks the install step current while Tailscale is installing", () => {
    const steps = setupSteps(
      {
        ...ready,
        phase: "installing",
        installed: false,
        installAttempted: true,
        installMode: "automatic",
      },
      "zh-CN",
    );
    expect(steps.map((step) => step.state)).toEqual([
      "done",
      "current",
      "pending",
      "pending",
    ]);
    expect(steps[1]?.body).toContain("macOS");
  });

  test("every phase has a tone and descriptions in both locales", () => {
    const phases = [
      "not_installed",
      "installing",
      "signed_out",
      "offline",
      "ready",
      "active",
      "conflict",
      "error",
    ] as const;
    for (const phase of phases) {
      expect(phaseTone[phase]).toBeTruthy();
      expect(copy.en.phaseDescriptions[phase]).toBeTruthy();
      expect(copy["zh-CN"].phaseDescriptions[phase]).toBeTruthy();
      expect(copy.en.nowDo[phase].length).toBeGreaterThan(0);
      expect(copy["zh-CN"].nowDo[phase].length).toBeGreaterThan(0);
    }
    expect(copy.en.setup.installBodyGeneric).toBeTruthy();
    expect(copy["zh-CN"].retryInstall).toBe("重新打开安装");
  });
});
