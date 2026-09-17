import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Component,
  type JSX,
} from "solid-js";
import {
  canEnable,
  copy,
  installAction,
  installModeLabel,
  isServeDisabledError,
  localeFromLanguage,
  needsCustomPort,
  serveAdminUrl,
  setupSteps,
  validCustomPort,
  type SetupStepState,
} from "./view-model";
import type { PluginComponentProps, PluginSettingsSurfaceContext } from "@ericsanchezok/synergy-plugin";
import type { RemoteAccessStatus } from "./types";
import "./settings.css";
import { createActionRunner, createStatusPolling } from "./controller";


const Settings: Component<PluginComponentProps<PluginSettingsSurfaceContext>> = ({ context }) => {
  const locale = localeFromLanguage(
    document.documentElement.lang || navigator.language,
  );
  const text = copy[locale];
  const [status, setStatus] = createSignal<RemoteAccessStatus>();
  const [busy, setBusy] = createSignal<string>();
  const [error, setError] = createSignal<string>();
  const [customPort, setCustomPort] = createSignal("1024");

  const polling = createStatusPolling({
    operations: context.operations,
    onStatus: setStatus,
    onError: setError,
  });
  const actions = createActionRunner({
    operations: context.operations,
    confirm: context.overlays.confirm,
    onBusy: setBusy,
    onStatus: setStatus,
    onError(message) {
      setError(message);
      if (message) context.overlays.notify(message, { kind: "error" });
    },
    onLaunched: () =>
      context.overlays.notify(text.launched, { kind: "success" }),
    onInstallResult(result) {
      if (result.launched) {
        context.overlays.notify(
          result.mode === "automatic"
            ? text.launchedAutomatic
            : text.launchedGuided,
          { kind: "success" },
        );
      } else {
        setError(text.installAlreadyStarted);
        context.overlays.notify(text.installAlreadyStarted, {
          kind: "warning",
        });
      }
    },
    refresh: polling.refresh,
  });

  onMount(() => {
    polling.start();
  });
  onCleanup(polling.stop);

  const phase = () => status()?.phase;
  const steps = createMemo(() => setupSteps(status(), locale));
  const nowDo = createMemo(() => {
    const current = phase();
    if (!current) return [] as readonly string[];
    return text.nowDo[current];
  });
  const detailRows = createMemo(() => {
    const current = status();
    if (!current) return [] as Array<[string, string]>;
    if (!current.installed) {
      return [
        [text.currentPhase, text.phases[current.phase]],
        [text.installMethod, installModeLabel(current, locale)],
        [text.client, text.clientMissing],
        [text.polling, text.pollingEvery],
      ];
    }
    return [
      [text.currentPhase, text.phases[current.phase]],
      [text.version, current.version ?? "—"],
      [text.device, current.deviceName ?? "—"],
      [text.tailnet, current.tailnetName ?? "—"],
      [text.port, current.httpsPort?.toString() ?? "—"],
      [text.client, text.clientInstalled],
    ];
  });
  const showSetup = createMemo(() => {
    const current = phase();
    return (
      current === "not_installed" ||
      current === "installing" ||
      current === "signed_out" ||
      current === "offline"
    );
  });
  const loading = createMemo(() => !status());
  const tone = createMemo(() => {
    const current = phase();
    if (current === "active" || current === "ready") return "success";
    if (current === "error") return "critical";
    if (
      current === "installing" ||
      current === "signed_out" ||
      current === "offline" ||
      current === "conflict"
    ) {
      return "warning";
    }
    return "muted";
  });

  return (
    <section class="sr-settings" aria-label={text.title}>
      <header class="sr-header">
        <div>
          <p class="sr-eyebrow">{text.eyebrow}</p>
          <h2 class="sr-title">{text.title}</h2>
          <p class="sr-intro">{text.intro}</p>
        </div>
        <Show
          when={status()}
          fallback={<span class="sr-pill">…</span>}
        >
          {(current) => (
            <span class="sr-pill" data-tone={tone()}>
              <span
                class="sr-dot"
                data-pulse={current().phase === "installing" ? "true" : "false"}
                aria-hidden="true"
              />
              {text.phases[current().phase]}
            </span>
          )}
        </Show>
      </header>

      <Show
        when={!loading()}
        fallback={
          <div class="sr-loading" aria-busy="true" aria-live="polite">
            <div class="sr-loading-card">
              <div class="sr-loading-row" data-w="lg" />
              <div class="sr-loading-row" data-w="md" />
              <div class="sr-loading-row" data-w="sm" />
              <p style="margin:8px 0 0;font-size:13px">{text.loadingStatus}</p>
            </div>
          </div>
        }
      >
        <div class="sr-grid" data-single={showSetup() ? "false" : "true"}>
          <section class="sr-card">
            <div>
              <h3 class="sr-card-title">
                {showSetup() ? text.installProgress : text.access}
              </h3>
              <p class="sr-card-copy">
                {text.phaseDescriptions[status()!.phase]}
              </p>
            </div>

          <Show when={showSetup()}>
            <ol class="sr-steps" aria-label={text.installProgress}>
              <For each={steps()}>
                {(step, index) => (
                  <li class="sr-step" data-state={step.state}>
                    <div class="sr-step-rail">
                      <StepMarker state={step.state} index={index() + 1} />
                    </div>
                    <div class="sr-step-body">
                      <div class="sr-step-title">{step.title}</div>
                      <p class="sr-step-copy">{step.body}</p>
                    </div>
                  </li>
                )}
              </For>
            </ol>
          </Show>

          <Show when={status()?.publicUrl}>
            {(url) => (
              <div class="sr-url">
                <code>{url()}</code>
                <div class="sr-actions">
                  <SecondaryButton
                    onClick={() => {
                      void copyText(url()).then((ok) =>
                        context.overlays.notify(
                          ok ? text.copied : text.copyFailed,
                          { kind: ok ? "success" : "error" },
                        ),
                      );
                    }}
                  >
                    {text.copy}
                  </SecondaryButton>
                  <a class="sr-link" href={url()} rel="noreferrer" target="_blank">
                    {text.open}
                  </a>
                </div>
              </div>
            )}
          </Show>

          <Show when={needsCustomPort(status())}>
            <label class="sr-field">
              {text.customPort}
              <input
                min="1024"
                max="65535"
                type="number"
                value={customPort()}
                onInput={(event) => setCustomPort(event.currentTarget.value)}
              />
            </label>
          </Show>

          <div
            class="sr-callout"
            data-tone={phase() === "active" ? "success" : undefined}
          >
            <strong>
              {phase() === "installing" || phase() === "not_installed"
                ? text.nowDoTitle
                : phase() === "active"
                  ? text.activeAccessTitle
                  : text.overview}
            </strong>
            <ul>
              <For each={[...nowDo()]}>{(item) => <li>{item}</li>}</For>
            </ul>
          </div>

          <Show when={status()?.message || error()}>
            <p class="sr-error" role="alert">
              {error() ?? status()?.message}
            </p>
          </Show>

          <div class="sr-actions">
            <Show when={installAction(status()) === "install"}>
              <PrimaryButton
                disabled={Boolean(busy())}
                onClick={() =>
                  void actions.confirmAndRun("remote.install", {
                    title: text.confirmInstallTitle,
                    message: text.confirmInstall,
                  })
                }
              >
                {text.install}
              </PrimaryButton>
            </Show>
            <Show when={installAction(status()) === "waiting"}>
              <PrimaryButton disabled>{text.waitingForTailscale}</PrimaryButton>
              <SecondaryButton
                disabled={Boolean(busy())}
                onClick={() =>
                  void actions.confirmAndRun("remote.install", {
                    title: text.confirmInstallTitle,
                    message: text.confirmInstall,
                  })
                }
              >
                {text.retryInstall}
              </SecondaryButton>
              <GhostButton
                disabled={Boolean(busy())}
                onClick={() => void polling.refresh()}
              >
                {text.refreshStatus}
              </GhostButton>
            </Show>
            <Show
              when={
                status()?.installed &&
                (!status()?.loggedIn || status()?.phase === "offline")
              }
            >
              <PrimaryButton
                disabled={Boolean(busy())}
                onClick={() => void actions.run("remote.login")}
              >
                {text.login}
              </PrimaryButton>
            </Show>
            <Show when={canEnable(status())}>
              <PrimaryButton
                disabled={
                  Boolean(busy()) ||
                  (needsCustomPort(status()) && !validCustomPort(customPort()))
                }
                onClick={() => {
                  const port = needsCustomPort(status())
                    ? Number(customPort())
                    : undefined;
                  void actions.confirmAndRun(
                    "remote.enable",
                    {
                      title: text.confirmEnableTitle,
                      message: text.confirmEnable,
                    },
                    port ? { httpsPort: port } : {},
                  );
                }}
              >
                {isServeDisabledError(status())
                  ? text.retryEnable
                  : text.enable}
              </PrimaryButton>
            </Show>
            <Show
              when={isServeDisabledError(status()) && serveAdminUrl(status())}
            >
              <SecondaryButton
                disabled={Boolean(busy())}
                onClick={() => {
                  const url = serveAdminUrl(status());
                  if (url) window.open(url, "_blank", "noreferrer");
                }}
              >
                {text.openServeAdmin}
              </SecondaryButton>
            </Show>
            <Show when={status()?.phase === "active" || status()?.desiredEnabled}>
              <SecondaryButton
                disabled={Boolean(busy())}
                onClick={() =>
                  void actions.confirmAndRun("remote.disable", {
                    title: text.confirmDisableTitle,
                    message: text.confirmDisable,
                    confirmLabel: text.disable,
                  })
                }
              >
                {text.disable}
              </SecondaryButton>
            </Show>
            <Show
              when={
                error() ||
                status()?.phase === "offline" ||
                status()?.phase === "error" ||
                status()?.phase === "conflict" ||
                status()?.phase === "ready"
              }
            >
              <GhostButton
                disabled={Boolean(busy())}
                onClick={() => void polling.refresh()}
              >
                {text.refreshStatus}
              </GhostButton>
            </Show>
          </div>
        </section>

        <Show when={showSetup()}>
          <aside class="sr-card" data-soft="true">
            <div>
              <h3 class="sr-card-title">{text.installDetails}</h3>
              <p class="sr-card-copy">
                {phase() === "installing"
                  ? text.phaseDescriptions.installing
                  : text.phaseDescriptions[status()?.phase ?? "not_installed"]}
              </p>
            </div>

            <dl class="sr-meta">
              <For each={detailRows()}>
                {(row) => (
                  <div class="sr-meta-row">
                    <dt>{row[0]}</dt>
                    <dd>{row[1]}</dd>
                  </div>
                )}
              </For>
            </dl>

            <div class="sr-callout">
              <strong>{text.afterInstallTitle}</strong>
              <ul>
                <For each={[...text.afterInstall]}>
                  {(item) => <li>{item}</li>}
                </For>
              </ul>
            </div>
          </aside>
        </Show>
        </div>
      </Show>

      <aside class="sr-safety">
        <div class="sr-shield" aria-hidden="true">
          ⌀
        </div>
        <div>
          <h3>{text.safetyTitle}</h3>
          <p>
            {phase() === "active" ? text.warning : text.warningBeforeEnable}
          </p>
        </div>
      </aside>
    </section>
  );
};

function StepMarker(props: { state: SetupStepState; index: number }) {
  return (
    <span class="sr-marker" data-state={props.state}>
      {props.state === "done" ? "✓" : props.index}
    </span>
  );
}

function PrimaryButton(props: {
  children: JSX.Element;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      class="sr-btn sr-btn-primary"
      disabled={props.disabled}
      type="button"
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function SecondaryButton(props: {
  children: JSX.Element;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      class="sr-btn sr-btn-secondary"
      disabled={props.disabled}
      type="button"
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function GhostButton(props: {
  children: JSX.Element;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      class="sr-btn sr-btn-ghost"
      disabled={props.disabled}
      type="button"
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

export default Settings;

async function copyText(value: string): Promise<boolean> {
  // Plugin surfaces run in an iframe where navigator.clipboard can be denied.
  // Fall back to execCommand like the host clipboard helper does.
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
