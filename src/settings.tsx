import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from "solid-js";
import {
  canEnable,
  copy,
  localeFromLanguage,
  needsCustomPort,
  phaseTone,
  validCustomPort,
} from "./view-model";
import type { RemoteAccessStatus, RemoteSettingsComponentProps } from "./types";
import { createActionRunner, createStatusPolling } from "./controller";

const Settings: Component<RemoteSettingsComponentProps> = (props) => {
  const locale = localeFromLanguage(
    document.documentElement.lang || navigator.language,
  );
  const text = copy[locale];
  const [status, setStatus] = createSignal<RemoteAccessStatus>();
  const [busy, setBusy] = createSignal<string>();
  const [error, setError] = createSignal<string>();
  const [customPort, setCustomPort] = createSignal("1024");
  const toneClass = createMemo(() => {
    const tone = status() ? phaseTone[status()!.phase] : "muted";
    if (tone === "success") return "text-icon-success-base";
    if (tone === "warning") return "text-icon-warning-base";
    if (tone === "critical") return "text-icon-critical-base";
    return "text-text-weak";
  });
  const polling = createStatusPolling({
    operations: props.context.operations,
    onStatus: setStatus,
    onError: setError,
  });
  const actions = createActionRunner({
    operations: props.context.operations,
    confirm: props.context.host.confirm,
    onBusy: setBusy,
    onStatus: setStatus,
    onError(message) {
      setError(message);
      if (message) props.context.host.notify(message, { kind: "error" });
    },
    onLaunched: () =>
      props.context.host.notify(text.launched, { kind: "success" }),
    refresh: polling.refresh,
  });

  onMount(() => {
    polling.start();
  });
  onCleanup(polling.stop);

  const rows = createMemo(() => {
    const current = status();
    if (!current) return [];
    return [
      [text.version, current.version],
      [text.device, current.deviceName],
      [text.tailnet, current.tailnetName],
      [text.port, current.httpsPort?.toString()],
    ].filter((row): row is [string, string] => Boolean(row[1]));
  });

  return (
    <section class="flex max-w-2xl flex-col gap-5" aria-label={text.title}>
      <header class="flex flex-col gap-1">
        <h2 class="text-lg font-medium text-text-strong">{text.title}</h2>
        <p class="text-sm text-text-weak">{text.intro}</p>
      </header>

      <div class="rounded-lg border border-border-base bg-surface-raised-base p-4">
        <div class="flex items-center justify-between gap-4">
          <span class="text-sm font-medium text-text-strong">
            {text.status}
          </span>
          <span class={`text-sm font-medium ${toneClass()}`}>
            {status() ? text.phases[status()!.phase] : "…"}
          </span>
        </div>
        <Show when={rows().length > 0}>
          <dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <For each={rows()}>
              {(row) => (
                <>
                  <dt class="text-text-weak">{row[0]}</dt>
                  <dd class="truncate text-right text-text-strong">{row[1]}</dd>
                </>
              )}
            </For>
          </dl>
        </Show>
      </div>

      <Show when={status()?.publicUrl}>
        {(url) => (
          <div class="flex flex-col gap-3 rounded-lg border border-border-base p-4">
            <code class="break-all text-sm text-text-strong">{url()}</code>
            <div class="flex flex-wrap gap-2">
              <button
                class="rounded-md border border-border-base px-3 py-2 text-sm text-text-strong"
                type="button"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(url())
                    .then(() =>
                      props.context.host.notify(text.copied, {
                        kind: "success",
                      }),
                    )
                    .catch((cause) =>
                      props.context.host.notify(
                        cause instanceof Error ? cause.message : String(cause),
                        { kind: "error" },
                      ),
                    );
                }}
              >
                {text.copy}
              </button>
              <a
                class="rounded-md border border-border-base px-3 py-2 text-sm text-text-strong"
                href={url()}
                rel="noreferrer"
                target="_blank"
              >
                {text.open}
              </a>
            </div>
          </div>
        )}
      </Show>

      <Show when={needsCustomPort(status())}>
        <label class="flex max-w-xs flex-col gap-2 text-sm text-text-strong">
          {text.customPort}
          <input
            class="rounded-md border border-border-base bg-surface-base px-3 py-2 text-text-strong"
            min="1024"
            max="65535"
            type="number"
            value={customPort()}
            onInput={(event) => setCustomPort(event.currentTarget.value)}
          />
        </label>
      </Show>

      <Show when={status()?.message || error()}>
        <p class="text-sm text-icon-critical-base" role="alert">
          {error() ?? status()?.message}
        </p>
      </Show>

      <div class="flex flex-wrap gap-2">
        <Show when={status()?.phase === "not_installed"}>
          <button
            class="rounded-md bg-surface-interactive-solid px-3 py-2 text-sm text-text-on-interactive-base"
            disabled={Boolean(busy())}
            type="button"
            onClick={() =>
              void actions.confirmAndRun("remote.install", {
                title: text.confirmInstallTitle,
                message: text.confirmInstall,
              })
            }
          >
            {text.install}
          </button>
        </Show>
        <Show
          when={
            status()?.installed &&
            (!status()?.loggedIn || status()?.phase === "offline")
          }
        >
          <button
            class="rounded-md bg-surface-interactive-solid px-3 py-2 text-sm text-text-on-interactive-base"
            disabled={Boolean(busy())}
            type="button"
            onClick={() => void actions.run("remote.login")}
          >
            {text.login}
          </button>
        </Show>
        <Show when={canEnable(status())}>
          <button
            class="rounded-md bg-surface-interactive-solid px-3 py-2 text-sm text-text-on-interactive-base"
            disabled={
              Boolean(busy()) ||
              (needsCustomPort(status()) && !validCustomPort(customPort()))
            }
            type="button"
            onClick={() => {
              const port = needsCustomPort(status())
                ? Number(customPort())
                : undefined;
              void actions.confirmAndRun(
                "remote.enable",
                { title: text.confirmEnableTitle, message: text.confirmEnable },
                port ? { httpsPort: port } : {},
              );
            }}
          >
            {text.enable}
          </button>
        </Show>
        <Show when={status()?.phase === "active" || status()?.desiredEnabled}>
          <button
            class="rounded-md border border-border-base px-3 py-2 text-sm text-text-strong"
            disabled={Boolean(busy())}
            type="button"
            onClick={() =>
              void actions.confirmAndRun("remote.disable", {
                title: text.confirmDisableTitle,
                message: text.confirmDisable,
                confirmLabel: text.disable,
              })
            }
          >
            {text.disable}
          </button>
        </Show>
        <Show
          when={
            error() ||
            status()?.phase === "offline" ||
            status()?.phase === "error"
          }
        >
          <button
            class="rounded-md border border-border-base px-3 py-2 text-sm text-text-strong"
            disabled={Boolean(busy())}
            type="button"
            onClick={() => void polling.refresh()}
          >
            {text.retry}
          </button>
        </Show>
      </div>

      <aside class="rounded-lg border border-border-base p-4 text-sm text-text-weak">
        {text.warning}
      </aside>
    </section>
  );
};

export default Settings;
