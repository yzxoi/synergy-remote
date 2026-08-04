import { RemoteStateStore } from "./state";
import { TailscaleManager } from "./tailscale/manager";
import {
  SystemTailscaleAdapter,
  type TailscaleAdapter,
} from "./tailscale/system";
import type { RemoteAccessStatus, RuntimeEndpoint } from "./types";

export type RuntimeTimer = { cancel(): void; unref?(): void };

export interface RuntimeTimers {
  set(callback: () => void, delayMs: number): RuntimeTimer;
}

const defaultTimers: RuntimeTimers = {
  set(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    return {
      cancel: () => clearTimeout(timer),
      unref: () => timer.unref?.(),
    };
  },
};

export class RemoteRuntimeController {
  private timer: RuntimeTimer | undefined;
  private stopped = true;
  private delayMs = 5_000;
  private endpoint: RuntimeEndpoint | undefined;
  private installMode: "automatic" | "guided" | undefined;


  constructor(
    readonly state = new RemoteStateStore(),
    readonly adapter: TailscaleAdapter = new SystemTailscaleAdapter(),
    private readonly timers = defaultTimers,
  ) {}

  manager() {
    return new TailscaleManager({
      adapter: this.adapter,
      state: this.state,
      endpoint: () => this.endpoint,
      installMode: () => this.installMode,
    });
  }

  setInstallMode(mode: "automatic" | "guided" | undefined) {
    this.installMode = mode;
  }

  setEndpoint(endpoint: RuntimeEndpoint) {
    this.endpoint = endpoint;
  }

  async start(endpoint: RuntimeEndpoint) {
    this.stop();
    this.stopped = false;
    this.delayMs = 5_000;
    this.endpoint = endpoint;
    try {
      return await this.tick();
    } catch (error) {
      this.scheduleRetry();
      throw error;
    }
  }

  async watchInstallation() {
    this.stopped = false;
    let delay = 2_000;
    const check = async () => {
      if (this.stopped) return;
      const status = await this.manager().status();
      if (status.installed) {
        if (!status.loggedIn) await this.adapter.login();
        if (this.endpoint) await this.tick();
        return;
      }
      this.setTimer(() => void check().catch(() => undefined), delay);
      delay = Math.min(delay * 2, 30_000);
    };
    await check();
  }

  stop() {
    this.stopped = true;
    this.timer?.cancel();
    this.timer = undefined;
  }

  private async tick(): Promise<RemoteAccessStatus> {
    const status = await this.manager().reconcile();
    if (this.stopped || !status.desiredEnabled) return status;
    if (status.phase === "active") {
      this.setTimer(
        () => void this.tick().catch(() => this.scheduleRetry()),
        5 * 60_000,
      );
    } else {
      this.scheduleRetry();
    }
    return status;
  }

  private scheduleRetry() {
    if (this.stopped) return;
    const delay = this.delayMs;
    this.delayMs = Math.min(this.delayMs * 2, 5 * 60_000);
    this.setTimer(
      () => void this.tick().catch(() => this.scheduleRetry()),
      delay,
    );
  }

  private setTimer(callback: () => void, delayMs: number) {
    this.timer?.cancel();
    this.timer = this.timers.set(callback, delayMs);
    this.timer.unref?.();
  }
}

export const remoteRuntime = new RemoteRuntimeController();
