import { createHash } from "node:crypto";
import type {
  RemoteAccessState,
  RemoteAccessStatus,
  RuntimeEndpoint,
} from "../types";
import {
  parseObject,
  parseServeRoutes,
  stringAt,
  type ServeRoute,
} from "./parsers";
import type { InstallResult, TailscaleAdapter } from "./system";

export interface StateStore {
  read(): Promise<RemoteAccessState>;
  write(value: RemoteAccessState): Promise<void>;
  remove(): Promise<void>;
}

type Snapshot = {
  installed: boolean;
  loggedIn: boolean;
  online: boolean;
  version?: string;
  deviceName?: string;
  dnsName?: string;
  tailnetName?: string;
  routes: Map<number, ServeRoute>;
  errorCode?: string;
  message?: string;
};

export class TailscaleManager {
  constructor(
    private readonly dependencies: {
      adapter: TailscaleAdapter;
      endpoint: () => RuntimeEndpoint | undefined;
      state: StateStore;
      installMode?: () => "automatic" | "guided" | undefined;
    },
  ) {}

  async status(): Promise<RemoteAccessStatus> {
    return this.toStatus(
      await this.snapshot(),
      await this.dependencies.state.read(),
    );
  }

  async install(force = false): Promise<InstallResult> {
    const state = await this.dependencies.state.read();
    if (state.installAttempted && !force)
      return { launched: false, mode: "guided" };
    await this.dependencies.state.write({ ...state, installAttempted: true });
    return this.dependencies.adapter.install();
  }

  login() {
    return this.dependencies.adapter.login();
  }

  async enable(
    input: { httpsPort?: number } = {},
  ): Promise<RemoteAccessStatus> {
    const state = await this.dependencies.state.read();
    const endpoint = this.dependencies.endpoint();
    if (!endpoint || !safeEndpoint(endpoint.url)) {
      return errorStatus(
        "UNSAFE_LISTENER",
        "Remote Access requires Synergy to listen on loopback only.",
        {},
        state.enabled,
        state.installAttempted,
      );
    }
    if (input.httpsPort !== undefined && !validHttpsPort(input.httpsPort)) {
      return errorStatus(
        "INVALID_PORT",
        "HTTPS port must be 443 or an integer between 1024 and 65535.",
        {},
        state.enabled,
        state.installAttempted,
      );
    }

    const snapshot = await this.snapshot();
    if (
      !snapshot.installed ||
      !snapshot.loggedIn ||
      !snapshot.online ||
      snapshot.errorCode
    ) {
      return this.toStatus(snapshot, state);
    }

    const target = normalizedTarget(endpoint.url);
    const candidates =
      input.httpsPort === undefined ? [443, 8443] : [input.httpsPort];
    const conflicts: number[] = [];
    let selected: number | undefined;
    for (const port of candidates) {
      const route = snapshot.routes.get(port);
      if (!route || ownsRoute(route, state) || routeMatchesTarget(route, target)) {
        selected = port;
        break;
      }
      conflicts.push(port);
    }
    if (selected === undefined) {
      return conflictStatus(
        snapshot,
        state,
        conflicts,
        "The preferred Tailscale Serve ports are already in use.",
      );
    }

    const existing = snapshot.routes.get(selected);
    const alreadyServing =
      existing &&
      !existing.funnel &&
      routeMatchesTarget(existing, target);

    if (!alreadyServing) {
      const result = await this.dependencies.adapter.run([
        "serve",
        "--bg",
        `--https=${selected}`,
        "--yes",
        target,
      ]);
      if (result.exitCode !== 0) {
        const serveDisabled = serveDisabledError(result);
        if (serveDisabled) {
          if (serveDisabled.url)
            this.dependencies.adapter.openUrl?.(serveDisabled.url);
          return errorStatus(
            "SERVE_DISABLED_ON_TAILNET",
            serveDisabled.message,
            snapshot,
            state.enabled,
            state.installAttempted,
          );
        }
        return errorStatus(
          "SERVE_ENABLE_FAILED",
          conciseError(result),
          snapshot,
          state.enabled,
          state.installAttempted,
        );
      }
    }

    if (state.httpsPort !== undefined && state.httpsPort !== selected) {
      const oldRoute = snapshot.routes.get(state.httpsPort);
      if (oldRoute && ownsRoute(oldRoute, state)) {
        await this.dependencies.adapter.run([
          "serve",
          `--https=${state.httpsPort}`,
          "off",
        ]);
      }
    }

    const next: RemoteAccessState = {
      ...state,
      enabled: true,
      httpsPort: selected,
      lastTargetFingerprint: targetFingerprint(target),
    };
    await this.dependencies.state.write(next);
    return this.toStatus(await this.snapshot(), next);
  }

  async disable(): Promise<RemoteAccessStatus> {
    const state = await this.dependencies.state.read();
    const snapshot = await this.snapshot();
    if (!state.enabled && state.httpsPort === undefined)
      return this.toStatus(snapshot, state);
    if (!snapshot.installed || snapshot.errorCode)
      return this.toStatus(snapshot, state);

    const route =
      state.httpsPort === undefined
        ? undefined
        : snapshot.routes.get(state.httpsPort);
    if (route && !ownsRoute(route, state)) {
      return conflictStatus(
        snapshot,
        state,
        [state.httpsPort!],
        "The Tailscale Serve route changed after Synergy Remote created it.",
      );
    }
    if (route) {
      const result = await this.dependencies.adapter.run([
        "serve",
        `--https=${state.httpsPort}`,
        "off",
      ]);
      if (result.exitCode !== 0) {
        return errorStatus(
          "SERVE_DISABLE_FAILED",
          conciseError(result),
          snapshot,
          state.enabled,
          state.installAttempted,
        );
      }
    }
    const next: RemoteAccessState = {
      enabled: false,
      installAttempted: state.installAttempted,
    };
    await this.dependencies.state.write(next);
    return this.toStatus(await this.snapshot(), next);
  }

  async reconcile(): Promise<RemoteAccessStatus> {
    const state = await this.dependencies.state.read();
    if (!state.enabled) return this.status();
    return this.enable({
      ...(state.httpsPort !== undefined ? { httpsPort: state.httpsPort } : {}),
    });
  }

  async uninstall(): Promise<RemoteAccessStatus> {
    const status = await this.disable();
    if (status.desiredEnabled) return status;
    await this.dependencies.state.remove();
    return status;
  }

  private async snapshot(): Promise<Snapshot> {
    const executable = await this.dependencies.adapter.executable();
    if (!executable)
      return {
        installed: false,
        loggedIn: false,
        online: false,
        routes: new Map(),
      };

    const [statusResult, versionResult, serveStatus] = await Promise.all([
      this.dependencies.adapter.run(["status", "--json"]),
      this.dependencies.adapter.run(["version"]),
      this.dependencies.adapter.run(["serve", "status", "--json"]),
    ]);
    if (statusResult.exitCode !== 0) {
      return {
        installed: true,
        loggedIn: false,
        online: false,
        version: firstLine(versionResult.stdout),
        routes: new Map(),
        errorCode: "STATUS_UNAVAILABLE",
        message: conciseError(statusResult),
      };
    }

    const status = parseObject(statusResult.stdout);
    const backendState = stringAt(status, "BackendState");
    const loggedIn =
      backendState !== "NeedsLogin" && backendState !== "NoState";
    const online = backendState === "Running";
    let routes =
      serveStatus.exitCode === 0
        ? parseServeRoutes(parseObject(serveStatus.stdout))
        : new Map<number, ServeRoute>();
    if (serveStatus.exitCode === 0 && routes.size === 0) {
      const config = await this.dependencies.adapter.run([
        "serve",
        "get-config",
        "--all",
      ]);
      if (config.exitCode === 0)
        routes = parseServeRoutes(parseObject(config.stdout));
    }
    return {
      installed: true,
      loggedIn,
      online,
      version: firstLine(versionResult.stdout),
      deviceName: stringAt(status, "Self", "HostName"),
      dnsName: stringAt(status, "Self", "DNSName")?.replace(/\.$/, ""),
      tailnetName: stringAt(status, "CurrentTailnet", "Name"),
      routes,
      ...(serveStatus.exitCode === 0
        ? {}
        : {
            errorCode: "SERVE_STATUS_UNAVAILABLE",
            message: conciseError(serveStatus),
          }),
    };
  }

  private toStatus(
    snapshot: Snapshot,
    state: RemoteAccessState,
  ): RemoteAccessStatus {
    const installMode = this.dependencies.installMode?.();
    const base = {
      provider: "tailscale" as const,
      desiredEnabled: state.enabled,
      installed: snapshot.installed,
      loggedIn: snapshot.loggedIn,
      online: snapshot.online,
      installAttempted: state.installAttempted,
      ...(installMode ? { installMode } : {}),
      ...(snapshot.version ? { version: snapshot.version } : {}),
      ...(snapshot.deviceName ? { deviceName: snapshot.deviceName } : {}),
      ...(snapshot.tailnetName ? { tailnetName: snapshot.tailnetName } : {}),
      ...(state.httpsPort !== undefined ? { httpsPort: state.httpsPort } : {}),
    };
    if (!snapshot.installed) {
      return {
        ...base,
        phase: state.installAttempted ? "installing" : "not_installed",
      };
    }
    if (snapshot.errorCode)
      return {
        ...base,
        phase: "error",
        errorCode: snapshot.errorCode,
        message: snapshot.message,
      };
    if (!snapshot.loggedIn) return { ...base, phase: "signed_out" };
    if (!snapshot.online) return { ...base, phase: "offline" };
    if (state.enabled && state.httpsPort !== undefined) {
      const route = snapshot.routes.get(state.httpsPort);
      if (route && ownsRoute(route, state)) {
        return {
          ...base,
          phase: "active",
          ...(snapshot.dnsName
            ? { publicUrl: publicUrl(snapshot.dnsName, state.httpsPort) }
            : {}),
        };
      }
      if (route) {
        return conflictStatus(
          snapshot,
          state,
          [state.httpsPort],
          "The Tailscale Serve route changed after Synergy Remote created it.",
        );
      }
    }
    return { ...base, phase: "ready" };
  }
}

function ownsRoute(route: ServeRoute, state: RemoteAccessState) {
  return Boolean(
    !route.funnel &&
      route.target &&
      state.lastTargetFingerprint &&
      targetFingerprint(route.target) === state.lastTargetFingerprint,
  );
}

function routeMatchesTarget(route: ServeRoute, target: string) {
  if (!route.target || route.funnel) return false;
  try {
    return targetFingerprint(route.target) === targetFingerprint(target);
  } catch {
    return false;
  }
}

function normalizedTarget(value: string) {
  const url = new URL(value);
  return url.origin;
}

function targetFingerprint(target: string) {
  let normalized = target;
  try {
    normalized = new URL(target).origin;
  } catch {}
  return createHash("sha256").update(normalized).digest("hex");
}

function safeEndpoint(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      !url.username &&
      !url.password &&
      (url.hostname === "127.0.0.1" ||
        url.hostname === "localhost" ||
        url.hostname === "[::1]" ||
        url.hostname === "::1") &&
      (url.pathname === "/" || url.pathname === "") &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function validHttpsPort(port: number) {
  return (
    Number.isInteger(port) && (port === 443 || (port >= 1024 && port <= 65535))
  );
}

function publicUrl(dnsName: string, port: number) {
  return `https://${dnsName}${port === 443 ? "" : `:${port}`}`;
}

function firstLine(value: string) {
  return value.trim().split(/\r?\n/, 1)[0];
}

function conciseError(result: {
  stderr: string;
  stdout: string;
  exitCode: number;
}) {
  const text = `${result.stdout}\n${result.stderr}`.trim();
  if (/Serve is not enabled on your tailnet/i.test(text)) {
    return (
      serveDisabledError(result)?.message ||
      "Serve is not enabled on your tailnet."
    );
  }
  if (result.exitCode === 124) {
    return (
      firstMeaningfulLine(text) ||
      "Tailscale command timed out. Check Tailscale Serve permissions and try again."
    );
  }
  return (
    firstMeaningfulLine(result.stderr) ||
    firstMeaningfulLine(result.stdout) ||
    `Tailscale exited with code ${result.exitCode}`
  );
}

function firstMeaningfulLine(value: string) {
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function serveDisabledError(result: {
  stderr: string;
  stdout: string;
}): { message: string; url?: string } | undefined {
  const text = `${result.stdout}\n${result.stderr}`;
  if (!/Serve is not enabled on your tailnet/i.test(text)) return;
  const url = text.match(
    /https:\/\/login\.tailscale\.com\/f\/serve\?[^\s]+/i,
  )?.[0];
  return {
    url,
    message: url
      ? `Serve is not enabled on your tailnet. Open ${url} to enable it for this device, then try again.`
      : "Serve is not enabled on your tailnet. Enable Serve in the Tailscale admin console for this device, then try again.",
  };
}

function errorStatus(
  errorCode: string,
  message: string,
  snapshot: Partial<Snapshot> = {},
  desiredEnabled = false,
  installAttempted = false,
): RemoteAccessStatus {
  return {
    provider: "tailscale",
    phase: "error",
    desiredEnabled,
    installed: snapshot.installed ?? false,
    loggedIn: snapshot.loggedIn ?? false,
    online: snapshot.online ?? false,
    installAttempted,
    errorCode,
    message,
  };
}

function conflictStatus(
  snapshot: Snapshot,
  state: RemoteAccessState,
  conflictPorts: number[],
  message: string,
): RemoteAccessStatus {
  return {
    provider: "tailscale",
    phase: "conflict",
    desiredEnabled: state.enabled,
    installed: snapshot.installed,
    loggedIn: snapshot.loggedIn,
    online: snapshot.online,
    installAttempted: state.installAttempted,
    ...(state.httpsPort !== undefined ? { httpsPort: state.httpsPort } : {}),
    conflictPorts,
    errorCode: "SERVE_PORT_CONFLICT",
    message,
  };
}
