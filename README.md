# Synergy Remote Tailscale

Discover and pair Synergy devices over [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve), then select a device in Synergy or move a paused task to it. This fork extends [EricSanchezok/synergy-remote](https://github.com/EricSanchezok/synergy-remote).

## Requirements

Both computers need Synergy with the additive `host.connection.manage` Host Service, the official Tailscale client, and access to the same tailnet. macOS, Windows and Linux are supported. Plugin API4 is unchanged; the settings component uses UI API6. The source changes target the next Synergy SDK release (`1.1.27`); while that release is pending, build against the matching Synergy source branch's Plugin SDK and Plugin Kit. Do not install a future SDK version from npm before it is published.

## Use

1. Build with `bun install`, `bun run build`, `bun run validate`, and `bun run pack`, then install the built artifact through Synergy's plugin installation flow on both devices. Approve the added **Pair remote devices** capability.
2. Open **Settings → Plugins → Remote Access** on each device. Complete the official Tailscale installer and sign-in flow, then enable remote access.
3. On the destination, select **Create pairing code**. On the source, select the discovered device and enter that code. The code expires after five minutes and can be used once.
4. Confirm the request on the destination, checking the displayed device name and Host ID. Complete pairing on the source. Pairing authorizes remote access to the instance's tasks and files.
5. Choose the paired device in Synergy's device selector, or open a paused task's **Move to another device** menu. The transferred task remains paused; click **Continue** on the destination to execute it.

The plugin lists Tailscale network candidates; a candidate must have Synergy Remote enabled before it can be paired. It probes the selected device on HTTPS port 443, falling back to 8443 when discovery of the first endpoint fails. For a custom HTTPS port, enter the displayed device address. Existing unrelated Serve and Funnel rules are never overwritten. Tailscale Funnel is never enabled.

## Authority and availability

Tailscale ACLs control network admission. Synergy Core controls application admission: a discovery result or pairing code alone cannot access tasks or files; the destination must confirm. Serve publishes only the authenticated pairing gateway. Core owns device signing keys, signed requests, replay prevention and revocation. The plugin receives no server bearer credential or private key. Anonymous gateway routes expose device metadata and pairing requests, rather than the full Synergy UI.

Revoke devices from the destination’s list to withdraw that device’s local admission of the peer. Revocation closes existing remote event connections and blocks subsequent requests there. Each Host owns its grant; revoke on both devices to remove both records. Disabling the plugin closes the gateway even when a Serve rule cannot be removed safely. A changed user-owned rule remains untouched, and normal uninstall reports cleanup failure; force uninstall can leave an inaccessible rule behind. The plugin never runs `tailscale serve reset`.

The source Host proxies the remote Web connection, so it must remain online for that connection. A migrated task executes independently on its destination; if the source goes offline, open Synergy locally on the destination. This version performs manual migration and does not provide automatic failover or ongoing Workspace replication. Both Hosts must meet Synergy's migration compatibility and paused-session requirements.

## Development

```bash
bun test
bun run typecheck
bun run build
bun run validate
bun run pack
```

When testing the unreleased Host Service, link the matching local Plugin SDK and Plugin Kit into a disposable development project's `node_modules`. Keep local link paths and generated package-manager locks out of published artifacts. The package scripts use the public `synergy-plugin` command and no assumed sibling checkout. Build/validate/pack produce an API4 runtime and UI6 artifact; runtime hooks retain the existing `runtime.endpoint.read` gate. Endpoint refresh uses live invocation snapshots and never retains Host Service callbacks in background timers.

Automated checks cover parser discovery, gateway path preservation, Serve ownership, single-owner cleanup and public contribution contracts. End-to-end acceptance uses isolated Synergy Hosts and a controlled Tailscale adapter; it does not prove routing between two physical networks. Marketplace publication and upstream submission are separate from this fork's review.
