import fs from "node:fs/promises";
import path from "node:path";

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};
export type InstallResult = { launched: boolean; mode: "automatic" | "guided" };

export interface TailscaleAdapter {
  readonly platform: NodeJS.Platform;
  executable(): Promise<string | undefined>;
  run(args: string[]): Promise<CommandResult>;
  install(): Promise<InstallResult>;
  login(): Promise<{ launched: boolean }>;
}

export interface SystemActions {
  exists(filepath: string): Promise<boolean>;
  read(filepath: string): Promise<string>;
  run(
    command: string,
    args: string[],
    options?: { env?: Record<string, string>; timeoutMs?: number },
  ): Promise<CommandResult>;
  launch(
    command: string,
    args: string[],
    options?: { env?: Record<string, string> },
  ): boolean;
}

const INSTALL = {
  mac: "https://tailscale.com/download/mac",
  windows: "https://tailscale.com/download/windows",
  linux: "https://tailscale.com/docs/install/linux",
} as const;

async function defaultRun(
  command: string,
  args: string[],
  options: { env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<CommandResult> {
  const child = Bun.spawn([command, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...options.env },
  });
  const timeout = setTimeout(() => child.kill(), options.timeoutMs ?? 15_000);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return {
      exitCode,
      stdout: stdout.slice(0, 1_000_000),
      stderr: stderr.slice(0, 100_000),
    };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function defaultLaunch(
  command: string,
  args: string[],
  options: { env?: Record<string, string> } = {},
) {
  try {
    const child = Bun.spawn([command, ...args], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      env: { ...process.env, ...options.env },
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

const defaultActions: SystemActions = {
  exists: (filepath) =>
    fs.access(filepath).then(
      () => true,
      () => false,
    ),
  read: (filepath) => fs.readFile(filepath, "utf8"),
  run: defaultRun,
  launch: defaultLaunch,
};

function pathCandidates(command: string, platform: NodeJS.Platform) {
  const extensions = platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  return (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap((directory) =>
      extensions.map((extension) =>
        path.join(directory, `${command}${extension}`),
      ),
    );
}

async function firstExisting(actions: SystemActions, candidates: string[]) {
  for (const candidate of candidates)
    if (await actions.exists(candidate)) return candidate;
}

function quoteForShell(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export class SystemTailscaleAdapter implements TailscaleAdapter {
  readonly platform: NodeJS.Platform;

  constructor(
    private readonly actions: SystemActions = defaultActions,
    platform: NodeJS.Platform = process.platform,
  ) {
    this.platform = platform;
  }

  async executable() {
    const candidates = pathCandidates("tailscale", this.platform);
    if (this.platform === "darwin") {
      candidates.push(
        "/usr/local/bin/tailscale",
        "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
        "/Applications/Tailscale.app/Contents/MacOS/Tailscale IPN",
      );
    }
    if (this.platform === "win32") {
      for (const root of [process.env.ProgramFiles, process.env.LOCALAPPDATA]) {
        if (root)
          candidates.push(path.join(root, "Tailscale", "tailscale.exe"));
      }
    }
    return firstExisting(this.actions, candidates);
  }

  async run(args: string[]) {
    const executable = await this.executable();
    if (!executable)
      return {
        exitCode: 127,
        stdout: "",
        stderr: "Tailscale CLI is not installed",
      };
    return this.actions.run(executable, args, {
      timeoutMs: 20_000,
      ...(this.platform === "darwin" ? { env: { TAILSCALE_BE_CLI: "1" } } : {}),
    });
  }

  async install(): Promise<InstallResult> {
    if (this.platform === "darwin") {
      const brew = await firstExisting(
        this.actions,
        pathCandidates("brew", this.platform),
      );
      if (brew) {
        const script = `${quoteForShell(brew)} install --cask tailscale-app`;
        return {
          launched: this.actions.launch("osascript", [
            "-e",
            `tell application \"Terminal\" to do script ${JSON.stringify(script)}`,
          ]),
          mode: "automatic",
        };
      }
      return { launched: this.openUrl(INSTALL.mac), mode: "guided" };
    }
    if (this.platform === "win32") {
      const winget = await firstExisting(
        this.actions,
        pathCandidates("winget", this.platform),
      );
      if (winget) {
        const command = `& '${winget.replaceAll("'", "''")}' install --id Tailscale.Tailscale --exact --accept-package-agreements --accept-source-agreements`;
        return {
          launched: this.actions.launch("powershell.exe", [
            "-NoExit",
            "-Command",
            command,
          ]),
          mode: "automatic",
        };
      }
      return { launched: this.openUrl(INSTALL.windows), mode: "guided" };
    }
    if (this.platform === "linux") {
      const supported = await this.supportedLinux();
      const terminal = await this.linuxTerminal();
      if (supported && terminal) {
        const script =
          "curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up";
        return {
          launched: this.launchTerminal(terminal, script),
          mode: "automatic",
        };
      }
      return { launched: this.openUrl(INSTALL.linux), mode: "guided" };
    }
    return { launched: false, mode: "guided" };
  }

  async login() {
    if (this.platform === "darwin") {
      return { launched: this.actions.launch("open", ["-a", "Tailscale"]) };
    }
    if (this.platform === "win32") {
      const executable = await this.executable();
      const ipn = executable
        ? path.join(path.dirname(executable), "tailscale-ipn.exe")
        : undefined;
      if (ipn && (await this.actions.exists(ipn)))
        return { launched: this.actions.launch(ipn, []) };
      return {
        launched: executable ? this.actions.launch(executable, ["up"]) : false,
      };
    }
    if (this.platform === "linux") {
      const terminal = await this.linuxTerminal();
      return {
        launched: terminal
          ? this.launchTerminal(terminal, "sudo tailscale up")
          : false,
      };
    }
    return { launched: false };
  }

  private openUrl(url: string) {
    if (this.platform === "darwin") return this.actions.launch("open", [url]);
    if (this.platform === "win32")
      return this.actions.launch("cmd.exe", ["/c", "start", "", url]);
    return this.actions.launch("xdg-open", [url]);
  }

  private async supportedLinux() {
    const value = await this.actions.read("/etc/os-release").catch(() => "");
    return /(?:^|\n)(?:ID|ID_LIKE)=(?:[^\n]*)(?:ubuntu|debian|rhel|fedora|centos|suse|amzn|oracle|photon)/i.test(
      value,
    );
  }

  private async linuxTerminal() {
    for (const command of [
      "gnome-terminal",
      "konsole",
      "xterm",
      "xfce4-terminal",
    ]) {
      const found = await firstExisting(
        this.actions,
        pathCandidates(command, this.platform),
      );
      if (found) return { command, executable: found };
    }
  }

  private launchTerminal(
    terminal: { command: string; executable: string },
    script: string,
  ) {
    if (terminal.command === "gnome-terminal")
      return this.actions.launch(terminal.executable, [
        "--",
        "bash",
        "-lc",
        script,
      ]);
    if (terminal.command === "xfce4-terminal")
      return this.actions.launch(terminal.executable, [
        "--command",
        `bash -lc ${quoteForShell(script)}`,
      ]);
    return this.actions.launch(terminal.executable, [
      "-e",
      "bash",
      "-lc",
      script,
    ]);
  }
}
