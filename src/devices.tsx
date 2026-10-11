import {
  createSignal,
  For,
  Show,
  onCleanup,
  onMount,
  type Component,
} from "solid-js";
import type {
  PluginHostDescriptor,
  PluginHostPeer,
  PluginHostPairingPending,
  PluginSettingsSurfaceContext,
} from "@ericsanchezok/synergy-plugin";
import type { TailscalePeer } from "./types";

type Devices = {
  self: PluginHostDescriptor;
  devices: TailscalePeer[];
  paired: PluginHostPeer[];
  pending: PluginHostPairingPending[];
};

export const DeviceSettings: Component<{
  context: PluginSettingsSurfaceContext;
}> = (props) => {
  const zh = () => props.context.environment.locale().startsWith("zh");
  const text = (en: string, cn: string) => (zh() ? cn : en);
  const [state, setState] = createSignal<Devices>();
  const [url, setUrl] = createSignal("");
  const [code, setCode] = createSignal("");
  const [invite, setInvite] = createSignal<{
    code: string;
    expiresAt: number;
  }>();
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const signal = props.context.lifetime.signal;
  async function refresh() {
    const value = await props.context.operations.query<Devices>(
      "remote.devices",
      {},
      { signal },
    );
    if (!signal.aborted) setState(value);
  }
  async function run(id: string, input: unknown = {}) {
    if (busy()) return;
    setBusy(true);
    setError("");
    try {
      const value = await props.context.operations.command(id, input, {
        signal,
      });
      if (signal.aborted) return;
      if (id === "remote.invite")
        setInvite(value as { code: string; expiresAt: number });
      if (id === "remote.pair") setCode("");
      await refresh();
    } catch (cause) {
      if (!signal.aborted)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  onMount(() => {
    void refresh().catch((cause) => setError(String(cause)));
    const timer = setInterval(() => void refresh().catch(() => {}), 5000);
    onCleanup(() => clearInterval(timer));
  });
  return (
    <section class="sr-card">
      <h2>{text("Devices", "设备")}</h2>
      <p class="sr-step-copy">
        {text(
          "Enable Remote Access on both devices. Create a code on the destination, enter it here, then confirm this device on the destination. Pairing grants remote task and file access.",
          "在两台设备上启用远程访问。在目标设备生成配对码，在此输入，然后在目标设备确认。配对将授权远程访问任务和文件。",
        )}
      </p>
      <Show when={state()}>
        {(value) => (
          <p>
            {value().self.name} <code>{value().self.id}</code>
          </p>
        )}
      </Show>
      <button
        class="sr-btn sr-btn-secondary"
        disabled={busy()}
        onClick={() => void run("remote.invite")}
      >
        {text("Create pairing code", "生成配对码")}
      </button>
      <Show when={invite()}>
        {(value) => (
          <p role="status">
            <code>{value().code}</code> ·{" "}
            {text(
              "Valid for 5 minutes, one use",
              "有效期 5 分钟，仅可使用一次",
            )}
          </p>
        )}
      </Show>
      <label class="sr-field">
        {text("Discovered devices", "发现的设备")}
        <select
          value={url()}
          onChange={(event) => setUrl(event.currentTarget.value)}
        >
          <option value="">{text("Choose a device", "选择设备")}</option>
          <For each={state()?.devices}>
            {(peer) => (
              <option disabled={!peer.online} value={`https://${peer.dnsName}`}>
                {peer.name}
                {peer.online ? "" : text(" (offline)", "（离线）")}
              </option>
            )}
          </For>
        </select>
      </label>
      <label class="sr-field">
        {text(
          "Device address (for a custom HTTPS port)",
          "设备地址（可填写自定义 HTTPS 端口）",
        )}
        <input
          type="url"
          value={url()}
          onInput={(event) => setUrl(event.currentTarget.value)}
          placeholder="https://device.tailnet.ts.net:8443"
        />
      </label>
      <label class="sr-field">
        {text("Pairing code from destination", "目标设备的配对码")}
        <input
          value={code()}
          onInput={(event) => setCode(event.currentTarget.value)}
          autocomplete="off"
        />
      </label>
      <button
        class="sr-btn sr-btn-primary"
        disabled={busy() || !url() || !code()}
        onClick={() => void run("remote.pair", { url: url(), code: code() })}
      >
        {text("Request pairing", "请求配对")}
      </button>
      <For each={state()?.pending}>
        {(request) => (
          <div class="sr-meta-row">
            <div>
              {request.device.name}
              <br />
              <code>{request.device.id}</code>
              <p>
                {request.direction === "incoming"
                  ? text(
                      "Requests remote task and file access",
                      "请求远程访问任务和文件",
                    )
                  : text(
                      "Waiting for destination confirmation",
                      "等待目标设备确认",
                    )}
              </p>
            </div>
            <Show
              when={
                request.direction === "incoming" && request.phase === "pending"
              }
              fallback={
                <Show when={request.direction === "outgoing"}>
                  <button
                    class="sr-btn sr-btn-secondary"
                    disabled={busy()}
                    onClick={() =>
                      void run("remote.finish", {
                        requestID: request.requestID,
                      })
                    }
                  >
                    {text("Complete pairing", "完成配对")}
                  </button>
                </Show>
              }
            >
              <button
                class="sr-btn sr-btn-primary"
                disabled={busy()}
                onClick={async () => {
                  if (
                    await props.context.overlays.confirm({
                      title: text("Pair device", "配对设备"),
                      message: `${request.device.name} (${request.device.id}) — ${text("Allow remote task and file access?", "允许远程访问任务和文件？")}`,
                    })
                  )
                    await run("remote.approve", {
                      requestID: request.requestID,
                    });
                }}
              >
                {text("Confirm device", "确认设备")}
              </button>
            </Show>
          </div>
        )}
      </For>
      <For each={state()?.paired}>
        {(peer) => (
          <div class="sr-meta-row">
            <span>
              {peer.name}
              <br />
              <code>{peer.id}</code>
            </span>
            <button
              class="sr-btn sr-btn-secondary"
              disabled={busy()}
              onClick={async () => {
                if (
                  await props.context.overlays.confirm({
                    title: text("Revoke pairing", "撤销配对"),
                    message: peer.name,
                  })
                )
                  await run("remote.revoke", { hostID: peer.id });
              }}
            >
              {text("Revoke", "撤销")}
            </button>
          </div>
        )}
      </For>
      <p class="sr-step-copy">
        {text(
          "Paired devices appear in Synergy’s device selector and paused task’s Move to another device menu. After migration, click Continue on the destination.",
          "配对后，设备会出现在 Synergy 的设备选择器，以及暂停任务的“移至另一台设备”菜单中。迁移后在目标设备点击继续。",
        )}
      </p>
      <Show when={error()}>
        <p role="alert" class="sr-error">
          {error()}
        </p>
      </Show>
    </section>
  );
};
