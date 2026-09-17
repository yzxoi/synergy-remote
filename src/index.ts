import z from "zod";
import {
  capability,
  definePlugin,
  hook,
  lifecycleInstall,
  lifecycleUninstall,
  operation,
  settings,
  type PluginInvocationContext,
} from "@ericsanchezok/synergy-plugin";
import { remoteRuntime } from "./runtime";
import { stateSettings } from "./state";
import type { RemoteInvocationContext } from "./types";

const Status = z
  .object({
    provider: z.literal("tailscale"),
    phase: z.enum([
      "not_installed",
      "installing",
      "signed_out",
      "offline",
      "ready",
      "active",
      "conflict",
      "error",
    ]),
    desiredEnabled: z.boolean(),
    installed: z.boolean(),
    loggedIn: z.boolean(),
    online: z.boolean(),
    installAttempted: z.boolean(),
    installMode: z.enum(["automatic", "guided"]).optional(),
    version: z.string().optional(),
    deviceName: z.string().optional(),
    tailnetName: z.string().optional(),
    publicUrl: z.string().url().optional(),
    httpsPort: z.number().int().optional(),
    conflictPorts: z.array(z.number().int()).optional(),
    errorCode: z.string().optional(),
    message: z.string().optional(),
  })
  .strict();

export const StatusSchema = Status;

const requirements = [
  "runtime.endpoint.read",
  "settings.read",
  "settings.write",
];

async function prepare(context: PluginInvocationContext, endpoint = true) {
  const typed = context as RemoteInvocationContext;
  if (!typed.settings?.get || !typed.settings.replace)
    throw new Error("Synergy Remote requires plugin settings access");
  await remoteRuntime.state.importSettings(await typed.settings.get());
  if (endpoint) {
    if (!typed.runtimeEndpoint)
      throw new Error("Synergy Remote requires runtime.endpoint.read");
    // Re-resolve the endpoint on every background cycle so a Synergy restart
    // that moves the server port self-heals instead of serving a dead target.
    remoteRuntime.setEndpointProvider(() => typed.runtimeEndpoint!.get());
    remoteRuntime.setEndpoint(await typed.runtimeEndpoint.get());
  }
  return typed;
}

async function sync(context: RemoteInvocationContext) {
  await context.settings!.replace!(
    stateSettings(await remoteRuntime.state.read()),
  );
}

const installContribution = lifecycleInstall({
  id: "remote.install",
  requires: ["settings.read", "settings.write"],
  async handler(context: PluginInvocationContext) {
    const typed = await prepare(context, false);
    const result = await remoteRuntime.manager().install();
    remoteRuntime.setInstallMode(result.launched ? result.mode : undefined);
    await sync(typed);
    if (result.launched) void remoteRuntime.watchInstallation();
  },
});

export const plugin = definePlugin({
  id: "synergy-remote-tailscale",
  name: "Synergy Remote Tailscale",
  version: "0.2.0",
  description: "Secure remote access to Synergy via Tailscale",
  author: "EricSanchez",
  homepage: "https://github.com/EricSanchezok/synergy-remote",
  compatibility: { synergy: ">=3.0.11" },
  license: "MIT",
  keywords: ["synergy-plugin", "remote-access", "tailscale"],
  capabilities: [
    capability("runtime.endpoint.read"),
    capability("settings.read"),
    capability("settings.write"),
    capability("ui.hostActions"),
  ],
  contributions: [
    operation({
      id: "remote.status",
      type: "query",
      input: z.object({}).strict(),
      output: Status,
      requires: requirements,
      async handler(_input, context) {
        const typed = await prepare(context);
        const status = await remoteRuntime.manager().status();
        await sync(typed);
        return status;
      },
    }),
    operation({
      id: "remote.install",
      type: "command",
      input: z.object({}).strict(),
      output: z
        .object({
          launched: z.boolean(),
          mode: z.enum(["automatic", "guided"]),
        })
        .strict(),
      requires: ["settings.read", "settings.write"],
      async handler(_input, context) {
        const typed = await prepare(context, false);
        const result = await remoteRuntime.manager().install(true);
        remoteRuntime.setInstallMode(result.launched ? result.mode : undefined);
        await sync(typed);
        if (result.launched) void remoteRuntime.watchInstallation();
        return result;
      },
    }),
    operation({
      id: "remote.login",
      type: "command",
      input: z.object({}).strict(),
      output: z.object({ launched: z.boolean() }).strict(),
      async handler() {
        return remoteRuntime.manager().login();
      },
    }),
    operation({
      id: "remote.enable",
      type: "command",
      input: z
        .object({
          httpsPort: z
            .union([z.literal(443), z.number().int().min(1024).max(65535)])
            .optional(),
        })
        .strict(),
      output: Status,
      requires: requirements,
      async handler(input, context) {
        const typed = await prepare(context);
        const status = await remoteRuntime.manager().enable(input);
        await sync(typed);
        if (status.phase === "active" || status.desiredEnabled) {
          const endpoint = await typed.runtimeEndpoint!.get();
          void remoteRuntime.start(endpoint).catch(() => undefined);
        }
        return status;
      },
    }),
    operation({
      id: "remote.disable",
      type: "command",
      input: z.object({}).strict(),
      output: Status,
      requires: ["settings.read", "settings.write"],
      async handler(_input, context) {
        const typed = await prepare(context, false);
        remoteRuntime.stop();
        const status = await remoteRuntime.manager().disable();
        await sync(typed);
        return status;
      },
    }),
    hook({
      id: "remote.runtime-started",
      point: "runtime.started",
      priority: 100,
      requires: requirements,
      async handler(_input, context) {
        const typed = await prepare(context);
        await remoteRuntime.start(await typed.runtimeEndpoint!.get());
        await sync(typed);
      },
    }),
    lifecycleUninstall({
      id: "remote.cleanup",
      requires: ["settings.read", "settings.write"],
      async handler(context) {
        await prepare(context, false);
        remoteRuntime.stop();
        const status = await remoteRuntime.manager().uninstall();
        if (status.desiredEnabled) {
          throw new Error(
            status.message ?? "Remote access could not be disabled safely",
          );
        }
      },
    }),
    installContribution,
    settings({
      id: "remote-access",
      label: "Remote Access",
      group: "Plugins",
      order: 300,
      component: { source: "./src/settings.tsx" },
    }),
  ],
  deactivate: async () => remoteRuntime.stop(),
});

export default plugin;
