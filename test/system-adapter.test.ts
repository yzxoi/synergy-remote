import { describe, expect, test } from "bun:test";
import {
  SystemTailscaleAdapter,
  type SystemActions,
} from "../src/tailscale/system";

function actions(
  input: {
    existing?: string[];
    files?: Record<string, string>;
    listings?: Record<string, string[]>;
  } = {},
) {
  const launched: Array<{ command: string; args: string[] }> = [];
  const existing = new Set(input.existing ?? []);
  const value: SystemActions = {
    exists: async (filepath) => existing.has(filepath),
    read: async (filepath) => input.files?.[filepath] ?? "",
    list: async (directory) => input.listings?.[directory] ?? [],
    run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    launch(command, args) {
      launched.push({ command, args });
      return true;
    },
  };
  return { value, launched };
}

describe("SystemTailscaleAdapter", () => {
  test("uses Homebrew for macOS and the official page as fallback", async () => {
    const automatic = actions({ existing: ["/opt/homebrew/bin/brew"] });
    const previous = process.env.PATH;
    process.env.PATH = "/opt/homebrew/bin";
    try {
      await expect(
        new SystemTailscaleAdapter(automatic.value, "darwin").install(),
      ).resolves.toMatchObject({
        mode: "automatic",
      });
      expect(automatic.launched[0]?.command).toBe("osascript");
      expect(automatic.launched[0]?.args.join(" ")).toContain("open \"$pkg\"");
    } finally {
      process.env.PATH = previous;
    }

    const guided = actions();
    await expect(
      new SystemTailscaleAdapter(guided.value, "darwin").install(),
    ).resolves.toMatchObject({
      mode: "guided",
    });
    expect(guided.launched).toContainEqual({
      command: "open",
      args: ["https://tailscale.com/download/mac"],
    });
  });

  test("opens a staged Homebrew pkg when the app is still missing", async () => {
    const pkg =
      "/opt/homebrew/Caskroom/tailscale-app/1.102.1/Tailscale-1.102.1-macos.pkg";
    const staged = actions({
      existing: [
        "/opt/homebrew/bin/brew",
        "/opt/homebrew/Caskroom/tailscale-app",
        pkg,
      ],
      listings: {
        "/opt/homebrew/Caskroom/tailscale-app": [
          "/opt/homebrew/Caskroom/tailscale-app/1.102.1",
        ],
        "/opt/homebrew/Caskroom/tailscale-app/1.102.1": [pkg],
      },
    });
    const previous = process.env.PATH;
    process.env.PATH = "/opt/homebrew/bin";
    try {
      await expect(
        new SystemTailscaleAdapter(staged.value, "darwin").install(),
      ).resolves.toEqual({
        launched: true,
        mode: "automatic",
      });
      expect(staged.launched).toEqual([{ command: "open", args: [pkg] }]);
    } finally {
      process.env.PATH = previous;
    }
  });

  test("uses winget on Windows and a visible terminal on supported Linux", async () => {
    const previous = process.env.PATH;
    process.env.PATH = "/tools";
    try {
      const windows = actions({ existing: ["/tools/winget.exe"] });
      await new SystemTailscaleAdapter(windows.value, "win32").install();
      expect(windows.launched[0]?.command).toBe("powershell.exe");
      expect(windows.launched[0]?.args.join(" ")).toContain(
        "Tailscale.Tailscale",
      );

      const linux = actions({
        existing: ["/tools/gnome-terminal"],
        files: { "/etc/os-release": "ID=ubuntu" },
      });
      await new SystemTailscaleAdapter(linux.value, "linux").install();
      expect(linux.launched[0]?.args.join(" ")).toContain(
        "https://tailscale.com/install.sh",
      );
      expect(linux.launched[0]?.args.join(" ")).toContain("sudo tailscale up");
    } finally {
      process.env.PATH = previous;
    }
  });
});
