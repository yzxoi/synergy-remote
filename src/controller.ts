import type { RemoteAccessStatus } from "./types";

type Operations = {
  query(
    id: string,
    input?: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
  command(
    id: string,
    input?: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
};

export function createStatusPolling(input: {
  operations: Operations;
  onStatus(status: RemoteAccessStatus): void;
  onError(error: string | undefined): void;
  intervalMs?: number;
  setInterval?: (callback: () => void, intervalMs: number) => unknown;
  clearInterval?: (timer: unknown) => void;
}) {
  let controller: AbortController | undefined;
  let timer: unknown;

  async function refresh() {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    try {
      const status = (await input.operations.query(
        "remote.status",
        {},
        { signal: current.signal },
      )) as RemoteAccessStatus;
      if (current.signal.aborted) return;
      input.onStatus(status);
      input.onError(undefined);
    } catch (cause) {
      if (!current.signal.aborted)
        input.onError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return {
    refresh,
    start() {
      void refresh();
      const schedule =
        input.setInterval ??
        ((callback, intervalMs) =>
          globalThis.setInterval(callback, intervalMs));
      timer = schedule(() => void refresh(), input.intervalMs ?? 4_000);
    },
    stop() {
      controller?.abort();
      if (timer !== undefined) {
        const clear =
          input.clearInterval ??
          ((value) =>
            globalThis.clearInterval(value as ReturnType<typeof setInterval>));
        clear(timer);
      }
    },
  };
}

export function createActionRunner(input: {
  operations: Operations;
  confirm(options: {
    title: string;
    message: string;
    confirmLabel?: string;
  }): Promise<boolean>;
  onBusy(id: string | undefined): void;
  onStatus(status: RemoteAccessStatus): void;
  onError(error: string | undefined): void;
  onLaunched(): void;
  refresh(): Promise<void>;
}) {
  let busy = false;

  async function withLock(id: string, task: () => Promise<boolean>) {
    if (busy) return false;
    busy = true;
    input.onBusy(id);
    input.onError(undefined);
    try {
      return await task();
    } finally {
      busy = false;
      input.onBusy(undefined);
    }
  }

  async function execute(id: string, value: Record<string, unknown>) {
    try {
      const result = (await input.operations.command(id, value)) as
        RemoteAccessStatus | { launched: boolean };
      if ("phase" in result) input.onStatus(result);
      else if (result.launched) input.onLaunched();
      await input.refresh();
      return true;
    } catch (cause) {
      input.onError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  }

  return {
    run(id: string, value: Record<string, unknown> = {}) {
      return withLock(id, () => execute(id, value));
    },
    async confirmAndRun(
      id: string,
      confirmation: { title: string; message: string; confirmLabel?: string },
      value: Record<string, unknown> = {},
    ) {
      return withLock(id, async () => {
        if (!(await input.confirm(confirmation))) return false;
        return execute(id, value);
      });
    },
  };
}
