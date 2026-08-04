import { describe, expect, test } from "bun:test";
import { TailscaleManager, type StateStore } from "../src/tailscale/manager";
import type { TailscaleAdapter } from "../src/tailscale/system";
import type { RemoteAccessState } from "../src/types";

function fixture(
  input: {
    routes?: Record<string, unknown>;
    state?: RemoteAccessState;
    endpoint?: string;
    notInstalled?: boolean;
  } = {},
) {
  let state = input.state ?? { enabled: false, installAttempted: false };
  let removed = false;
  let installs = 0;
  const commands: string[][] = [];
  const adapter: TailscaleAdapter = {
    platform: "linux",
    executable: async () =>
      input.notInstalled ? undefined : "/usr/bin/tailscale",
    install: async () => {
      installs++;
      return { launched: true, mode: "automatic" };
    },
    login: async () => ({ launched: true }),
    async run(args) {
      commands.push(args);
      if (args[0] === "status") {
        return {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({
            BackendState: "Running",
            Self: { HostName: "host", DNSName: "host.example.ts.net." },
            CurrentTailnet: { Name: "example" },
          }),
        };
      }
      if (args[0] === "version")
        return { exitCode: 0, stdout: "1.98.0\n", stderr: "" };
      if (args[0] === "serve" && args[1] === "status") {
        return {
          exitCode: 0,
          stdout: JSON.stringify(input.routes ?? { Web: {} }),
          stderr: "",
        };
      }
      if (args[0] === "serve" && args[1] === "get-config") {
        return {
          exitCode: 0,
          stdout: JSON.stringify(input.routes ?? { Web: {} }),
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };
  const store: StateStore = {
    read: async () => ({ ...state }),
    write: async (next) => {
      state = { ...next };
    },
    remove: async () => {
      removed = true;
      state = { enabled: false, installAttempted: false };
    },
  };
  return {
    manager: new TailscaleManager({
      adapter,
      state: store,
      endpoint: () => ({
        url: input.endpoint ?? "http://127.0.0.1:4096",
        generation: "one",
      }),
    }),
    commands,
    installs: () => installs,
    removed: () => removed,
    state: () => state,
  };
}

describe("TailscaleManager", () => {
  test("prefers 443 and persists only plugin-owned route state", async () => {
    const item = fixture();
    const status = await item.manager.enable();
    expect(status.desiredEnabled).toBe(true);
    expect(item.state()).toMatchObject({ enabled: true, httpsPort: 443 });
    expect(item.commands).toContainEqual([
      "serve",
      "--bg",
      "--https=443",
      "--yes",
      "http://127.0.0.1:4096",
    ]);
  });

  test("falls back to 8443 and reports a double conflict without overwriting", async () => {
    const routes = {
      Web: {
        "host:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } },
      },
    };
    const fallback = fixture({ routes });
    await fallback.manager.enable();
    expect(fallback.state().httpsPort).toBe(8443);

    const conflict = fixture({
      routes: {
        Web: {
          ...routes.Web,
          "host:8443": {
            Handlers: { "/": { Proxy: "http://127.0.0.1:3001" } },
          },
        },
      },
    });
    await expect(conflict.manager.enable()).resolves.toMatchObject({
      phase: "conflict",
      conflictPorts: [443, 8443],
    });
    expect(conflict.commands.some((command) => command.includes("--bg"))).toBe(
      false,
    );
  });

  test("updates an owned target after a managed port change and never resets Serve", async () => {
    const first = fixture();
    await first.manager.enable({ httpsPort: 443 });
    const previous = first.state();
    const second = fixture({
      state: previous,
      endpoint: "http://127.0.0.1:5099",
      routes: {
        Web: {
          "host:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:4096" } } },
        },
      },
    });
    await second.manager.reconcile();
    expect(second.commands).toContainEqual([
      "serve",
      "--bg",
      "--https=443",
      "--yes",
      "http://127.0.0.1:5099",
    ]);
    expect(second.commands.flat()).not.toContain("reset");
  });

  test("refuses non-loopback endpoints", async () => {
    await expect(
      fixture({ endpoint: "http://192.168.1.20:4096" }).manager.enable(),
    ).resolves.toMatchObject({
      phase: "error",
      errorCode: "UNSAFE_LISTENER",
    });
  });

  test("uses a custom port only when requested and treats Funnel as occupied", async () => {
    const item = fixture({
      routes: {
        AllowFunnel: { "host:443": true },
        Web: {
          "host:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } },
          "host:8443": {
            Handlers: { "/": { Proxy: "http://127.0.0.1:3001" } },
          },
        },
      },
    });
    await expect(item.manager.enable()).resolves.toMatchObject({
      phase: "conflict",
      conflictPorts: [443, 8443],
    });
    await item.manager.enable({ httpsPort: 9443 });
    expect(item.commands).toContainEqual([
      "serve",
      "--bg",
      "--https=9443",
      "--yes",
      "http://127.0.0.1:4096",
    ]);
  });

  test("turns off only a still-owned port and blocks normal uninstall after user modification", async () => {
    const created = fixture();
    await created.manager.enable({ httpsPort: 443 });
    const ownedState = created.state();

    const owned = fixture({
      state: ownedState,
      routes: {
        Web: {
          "host:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:4096" } } },
        },
      },
    });
    await owned.manager.disable();
    expect(owned.commands).toContainEqual(["serve", "--https=443", "off"]);
    expect(owned.state().enabled).toBe(false);

    const modified = fixture({
      state: ownedState,
      routes: {
        Web: {
          "host:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:9999" } } },
        },
      },
    });
    await expect(modified.manager.uninstall()).resolves.toMatchObject({
      phase: "conflict",
      desiredEnabled: true,
    });
    expect(modified.removed()).toBe(false);
    expect(modified.commands.some((command) => command.at(-1) === "off")).toBe(
      false,
    );
  });

  test("attempts automatic installation once unless the user explicitly retries", async () => {
    const item = fixture();
    await item.manager.install();
    await item.manager.install();
    expect(item.installs()).toBe(1);
    await item.manager.install(true);
    expect(item.installs()).toBe(2);
  });

  test("reports installing only after an install attempt", async () => {
    const fresh = fixture({ notInstalled: true });
    await expect(fresh.manager.status()).resolves.toMatchObject({
      phase: "not_installed",
      installed: false,
      installAttempted: false,
    });

    const started = fixture({
      notInstalled: true,
      state: { enabled: false, installAttempted: true },
    });
    await expect(started.manager.status()).resolves.toMatchObject({
      phase: "installing",
      installed: false,
      installAttempted: true,
    });
  });

  test("leaves installing once Tailscale is installed", async () => {
    const item = fixture({
      state: { enabled: false, installAttempted: true },
    });
    await expect(item.manager.status()).resolves.toMatchObject({
      phase: "ready",
      installed: true,
      installAttempted: true,
    });
  });
});
