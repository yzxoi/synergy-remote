import { describe, expect, test } from "bun:test";
import {
  canEnable,
  localeFromLanguage,
  needsCustomPort,
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
});
