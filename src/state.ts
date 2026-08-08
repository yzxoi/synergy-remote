import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RemoteAccessState } from "./types";

const defaults: RemoteAccessState = { enabled: false, installAttempted: false };

function statePath() {
  const home =
    process.env.SYNERGY_HOME ?? process.env.SYNERGY_TEST_HOME ?? os.homedir();
  return path.join(
    home,
    ".synergy",
    "data",
    "plugin",
    "synergy-remote-tailscale",
    "remote-access.json",
  );
}

function parseState(value: unknown): RemoteAccessState {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { ...defaults };
  const input = value as Record<string, unknown>;
  return {
    enabled: input.enabled === true,
    installAttempted: input.installAttempted === true,
    ...(Number.isInteger(input.httpsPort)
      ? { httpsPort: Number(input.httpsPort) }
      : {}),
    ...(typeof input.lastTargetFingerprint === "string" &&
    /^[a-f0-9]{64}$/.test(input.lastTargetFingerprint)
      ? { lastTargetFingerprint: input.lastTargetFingerprint }
      : {}),
  };
}

export class RemoteStateStore {
  constructor(private readonly filepath = statePath()) {}

  async read(): Promise<RemoteAccessState> {
    const value = await Bun.file(this.filepath)
      .json()
      .catch(() => undefined);
    return parseState(value);
  }

  async write(value: RemoteAccessState): Promise<void> {
    const normalized = parseState(value);
    await fs.mkdir(path.dirname(this.filepath), { recursive: true });
    const temporary = `${this.filepath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await Bun.write(temporary, `${JSON.stringify(normalized, null, 2)}\n`);
    await fs.rename(temporary, this.filepath);
  }

  async importSettings(
    values: Record<string, unknown>,
  ): Promise<RemoteAccessState> {
    const current = await this.read();
    const exists = await Bun.file(this.filepath).exists();
    if (exists) return current;
    const imported = parseState(values);
    await this.write(imported);
    return imported;
  }

  async remove(): Promise<void> {
    await fs.rm(this.filepath, { force: true });
  }
}

export function stateSettings(
  value: RemoteAccessState,
): Record<string, unknown> {
  return {
    enabled: value.enabled,
    installAttempted: value.installAttempted,
    ...(value.httpsPort !== undefined ? { httpsPort: value.httpsPort } : {}),
    ...(value.lastTargetFingerprint
      ? { lastTargetFingerprint: value.lastTargetFingerprint }
      : {}),
  };
}
