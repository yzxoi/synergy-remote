import { z } from "zod";
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
  "host.connection.manage",
  "settings.read",
  "settings.write",
];

async function prepare(context: PluginInvocationContext, endpoint = true) {
  const typed = context as RemoteInvocationContext;
  if (!typed.settings?.get || !typed.settings.replace)
    throw new Error("Synergy Remote requires plugin settings access");
  await remoteRuntime.state.importSettings(await typed.settings.get());
  if (endpoint) {
    if (!typed.hostConnection)
      throw new Error("Synergy Remote requires host.connection.manage");
    const endpoint = await typed.hostConnection.endpoint();
    remoteRuntime.setEndpointProvider(async () => endpoint);
    remoteRuntime.setEndpoint(endpoint);
    const status = await remoteRuntime.manager().status();
    await typed.hostConnection.configure({
      enabled: status.phase === "active",
      name: status.deviceName ?? "Synergy",
      url: status.publicUrl,
    });
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

const PairResult = z
  .object({
    requestID: z.string(),
    phase: z.enum(["pending", "approved"]),
    device: z.string(),
  })
  .strict();
const requestInput = z.object({ requestID: z.string().uuid() }).strict();
const descriptor = z
  .object({
    id: z.string(),
    version: z.string(),
    platform: z.string(),
    name: z.string(),
    publicKey: z.string(),
    url: z.string().optional(),
    components: z.array(
      z.object({
        id: z.string(),
        version: z.string(),
        apiVersion: z.literal(1),
      }),
    ),
  })
  .strict();
const deviceContributions = [
  operation({
    id: "remote.devices",
    type: "query",
    input: z.object({}).strict(),
    output: z
      .object({
        self: descriptor,
        devices: z.array(
          z
            .object({
              id: z.string(),
              name: z.string(),
              dnsName: z.string(),
              online: z.boolean(),
            })
            .strict(),
        ),
        paired: z.array(
          descriptor
            .extend({ pairedAt: z.number(), connectionPath: z.string() })
            .strict(),
        ),
        pending: z.array(
          z
            .object({
              requestID: z.string(),
              direction: z.enum(["incoming", "outgoing"]),
              device: descriptor,
              expiresAt: z.number(),
              phase: z.enum(["pending", "approved"]),
            })
            .strict(),
        ),
      })
      .strict(),
    requires: requirements,
    async handler(_input, context) {
      const typed = await prepare(context);
      const status = await remoteRuntime.manager().status();
      const self = await typed.hostConnection!.configure({
        enabled: status.phase === "active",
        name: status.deviceName ?? "Synergy",
        url: status.publicUrl,
      });
      const [devices, paired, pending] = await Promise.all([
        remoteRuntime.manager().devices(),
        typed.hostConnection!.peers(),
        typed.hostConnection!.pending(),
      ]);
      return { self, devices, paired, pending };
    },
  }),
  operation({
    id: "remote.invite",
    type: "command",
    input: z.object({}).strict(),
    output: z.object({ code: z.string(), expiresAt: z.number() }).strict(),
    requires: requirements,
    async handler(_input, context) {
      const typed = await prepare(context);
      return typed.hostConnection!.invite();
    },
  }),
  operation({
    id: "remote.pair",
    type: "command",
    input: z
      .object({ url: z.string().url(), code: z.string().min(1).max(32) })
      .strict(),
    output: PairResult,
    requires: requirements,
    async handler(input, context) {
      const typed = await prepare(context);
      const target = await typed
        .hostConnection!.probe({ url: input.url })
        .catch(async (cause) => {
          const url = new URL(input.url);
          if (
            url.protocol !== "https:" ||
            url.port ||
            !url.hostname.endsWith(".ts.net")
          )
            throw cause;
          url.port = "8443";
          return typed.hostConnection!.probe({ url: url.origin });
        });
      const result = await typed.hostConnection!.pair({
        target,
        code: input.code,
      });
      return {
        requestID: result.requestID,
        phase: result.phase,
        device: result.target.name,
      };
    },
  }),
  operation({
    id: "remote.approve",
    type: "command",
    input: requestInput,
    output: PairResult,
    requires: requirements,
    async handler(input, context) {
      const typed = await prepare(context);
      const result = await typed.hostConnection!.approve(input);
      return {
        requestID: result.requestID,
        phase: result.phase,
        device: result.requester.name,
      };
    },
  }),
  operation({
    id: "remote.finish",
    type: "command",
    input: requestInput,
    output: PairResult,
    requires: requirements,
    async handler(input, context) {
      const typed = await prepare(context);
      const result = await typed.hostConnection!.finish(input);
      return {
        requestID: result.requestID,
        phase: result.phase,
        device: result.target.name,
      };
    },
  }),
  operation({
    id: "remote.revoke",
    type: "command",
    input: z.object({ hostID: z.string().uuid() }).strict(),
    output: z.object({ revoked: z.literal(true) }).strict(),
    requires: requirements,
    async handler(input, context) {
      const typed = await prepare(context);
      await typed.hostConnection!.revoke(input);
      return { revoked: true as const };
    },
  }),
];

export const plugin = definePlugin({
  id: "synergy-remote-tailscale",
  name: "Synergy Remote Tailscale",
  version: "0.2.0",
  description: "Discover and pair Synergy devices over Tailscale",
  author: "EricSanchez",
  homepage: "https://github.com/EricSanchezok/synergy-remote",
  compatibility: { synergy: ">=1.1.27 <2.0.0" },
  license: "MIT",
  keywords: ["synergy-plugin", "remote-access", "tailscale"],
  capabilities: [
    capability("runtime.endpoint.read"),
    capability("host.connection.manage"),
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
        await typed.hostConnection!.configure({
          enabled: status.phase === "active",
          name: status.deviceName ?? "Synergy",
          url: status.publicUrl,
        });
        await sync(typed);
        if (status.phase === "active" || status.desiredEnabled) {
          const endpoint = await typed.hostConnection!.endpoint();
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
      requires: requirements,
      async handler(_input, context) {
        const typed = await prepare(context, false);
        await typed.hostConnection!.configure({
          enabled: false,
          name: "Synergy",
        });
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
      requires: [...requirements, "runtime.endpoint.read"],
      async handler(_input, context) {
        const typed = await prepare(context);
        const status = await remoteRuntime.start(
          await typed.hostConnection!.endpoint(),
        );
        await typed.hostConnection!.configure({
          enabled: status.phase === "active",
          name: status.deviceName ?? "Synergy",
          url: status.publicUrl,
        });
        await sync(typed);
      },
    }),
    lifecycleUninstall({
      id: "remote.cleanup",
      requires: requirements,
      async handler(context) {
        const typed = await prepare(context, false);
        await typed.hostConnection!.configure({
          enabled: false,
          name: "Synergy",
        });
        remoteRuntime.stop();
        const status = await remoteRuntime.manager().uninstall();
        if (status.phase === "conflict" || status.phase === "error") {
          throw new Error(
            status.message ?? "Remote access could not be disabled safely",
          );
        }
      },
    }),
    ...deviceContributions,
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
