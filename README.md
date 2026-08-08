# Synergy Remote Tailscale

Secure remote access to a complete Synergy instance through [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve).

Synergy Remote does not create a public endpoint, never enables Tailscale Funnel, and stores no Tailscale password, OAuth token, or auth key. Authentication is completed by the official Tailscale client. The computer running Synergy and every remote device must be signed in to the same tailnet, and access is governed by that tailnet's ACL policy.

## Requirements

- Synergy `1.1.27` or later with the generic `runtime.endpoint.read`, `runtime.started`, and `lifecycle.install` API4 additions.
- macOS, Windows, or Linux.
- The official Tailscale client on the Synergy computer and the remote device.
- Synergy listening only on loopback. `bun dev desktop --managed` configures this automatically.

## Use

1. Build and register the plugin:

   ```bash
   bun install
   bun run build
   synergy plugin add file:///absolute/path/to/synergy-remote-tailscale
   ```

2. Open **Settings → Plugins → Remote Access**.
3. Complete the official Tailscale installer and sign-in flow. A fresh plugin install tries the platform installer once; if it cannot do so, it opens the official installation page. The settings panel switches to an in-progress install state while Tailscale is being installed; finish the installer in the window or page it opened, and use **Retry install** if nothing opened.
4. Select **Enable Remote Access** and approve the warning.
5. Open the displayed HTTPS address from another device in the same tailnet.

The plugin prefers HTTPS port `443`, falls back to `8443`, and asks for a custom port from `1024` to `65535` only when both are occupied. Existing Serve and Funnel rules are never overwritten.

## Recovery and removal

The plugin stores `enabled`, the selected HTTPS port, its last target fingerprint, and the one-time installation-attempt flag in plugin-owned data. It mirrors the user-facing fields to Synergy plugin settings, but Core stores no remote-access provider state. The plugin safely updates its owned Serve target when a managed Desktop restart chooses a different local port. If Tailscale is unavailable, signed out, or offline, the intent is retained and recovery retries use capped backoff.

Disabling or normally uninstalling the plugin removes only the exact Serve rule whose port and target fingerprint still match the rule created by Synergy Remote. A changed or user-owned rule is left untouched; force uninstall may therefore leave an inaccessible external rule behind. The plugin never runs `tailscale serve reset`.

All Tailscale detection, installation, login, Serve parsing, ownership checks, persistence, and retry behavior lives in this plugin process. Synergy Core supplies only the credential-free loopback endpoint and lifecycle notifications.

## Security boundary

The remote address exposes the entire Synergy instance, including normal UI and realtime transports. Synergy Remote does not add Scope-level isolation or inspect Tailscale identity headers. Anyone permitted by the tailnet ACL may be able to access the instance. Review your Tailscale ACL before enabling the route.

## Development checks

```bash
bun test
bun run typecheck
bun run build
bun run validate
bun run pack
```

Marketplace publication, signing, and remote repository changes are intentionally outside this project setup.
