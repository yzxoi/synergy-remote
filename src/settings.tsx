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
  localeFromLanguage,
  needsCustomPort,
  phaseTone,
  setupSteps,
  validCustomPort,
  type SetupStepState,
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

  const pillClass = createMemo(() => {
    const tone = status() ? phaseTone[status()!.phase] : "muted";
    if (tone === "success") {
      return "border-border-success-base bg-surface-success-base text-icon-success-base";
    }
    if (tone === "warning") {
      return "border-border-warning-base bg-surface-warning-base text-icon-warning-base";
    }
    if (tone === "critical") {
      return "border-border-critical-base bg-surface-critical-base text-icon-critical-base";
    }
    return "border-border-base bg-surface-raised-base text-text-weak";
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
    onInstallResult(result) {
      if (result.launched) {
        props.context.host.notify(
          result.mode === "automatic"
            ? text.launchedAutomatic
            : text.launchedGuided,
          { kind: "success" },
        );
      } else {
        setError(text.installAlreadyStarted);
        props.context.host.notify(text.installAlreadyStarted, {
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
    if (!current) return text.nowDo.not_installed;
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

  const showSetup =
    !status() ||
    phase() === "not_installed" ||
    phase() === "installing" ||
    phase() === "signed_out" ||
    phase() === "offline";

  return (
    <section class="flex w-full max-w-4xl flex-col gap-5" aria-label={text.title}>
      <header class="flex items-start justify-between gap-4 border-b border-border-weak pb-4">
        <div class="flex min-w-0 flex-col gap-2">
          <p class="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-interactive-base">
            {text.eyebrow}
          </p>
          <div class="flex flex-col gap-1">
            <h2 class="text-xl font-semibold tracking-tight text-text-strong">
              {text.title}
            </h2>
            <p class="max-w-2xl text-sm leading-6 text-text-weak">{text.intro}</p>
          </div>
        </div>
        <Show
          when={status()}
          fallback={
            <span class="shrink-0 rounded-full border border-border-base px-3 py-1.5 text-xs font-medium text-text-weak">
              …
            </span>
          }
        >
          {(current) => (
            <span
              class={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${pillClass()}`}
            >
              <span
                aria-hidden="true"
                class={`h-1.5 w-1.5 rounded-full bg-current ${
                  current().phase === "installing" ? "animate-pulse" : ""
                }`}
              />
              {text.phases[current().phase]}
            </span>
          )}
        </Show>
      </header>

      <div
        class={`grid gap-4 ${
          showSetup ? "lg:grid-cols-[minmax(0,1.35fr)_minmax(16rem,0.9fr)]" : ""
        }`}
      >
        <section class="flex flex-col gap-4 rounded-2xl border border-border-base bg-surface-base p-4">
          <div class="flex flex-col gap-1">
            <h3 class="text-sm font-semibold text-text-strong">
              {showSetup ? text.installProgress : text.access}
            </h3>
            <Show when={status()}>
              <p class="text-sm leading-6 text-text-weak">
                {text.phaseDescriptions[status()!.phase]}
              </p>
            </Show>
          </div>

          <Show when={showSetup}>
            <ol class="flex flex-col" aria-label={text.installProgress}>
              <For each={steps()}>
                {(step, index) => (
                  <li class="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
                    <div class="relative flex justify-center">
                      <StepMarker state={step.state} index={index() + 1} />
                      <Show when={index() < steps().length - 1}>
                        <span
                          aria-hidden="true"
                          class="absolute top-7 bottom-0 w-px bg-border-weak"
                        />
                      </Show>
                    </div>
                    <div class={index() < steps().length - 1 ? "pb-4" : ""}>
                      <div
                        class={`text-sm font-semibold ${
                          step.state === "pending"
                            ? "text-text-weak"
                            : "text-text-strong"
                        }`}
                      >
                        {step.title}
                      </div>
                      <p
                        class={`mt-0.5 text-xs leading-5 ${
                          step.state === "pending"
                            ? "text-text-weak"
                            : "text-text-base"
                        }`}
                      >
                        {step.body}
                      </p>
                    </div>
                  </li>
                )}
              </For>
            </ol>
          </Show>

          <Show when={status()?.publicUrl}>
            {(url) => (
              <div class="flex flex-col gap-3 rounded-xl border border-border-base bg-surface-raised-base p-3">
                <code class="break-all text-sm text-text-strong">{url()}</code>
                <div class="flex flex-wrap gap-2">
                  <SecondaryButton
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
                            cause instanceof Error
                              ? cause.message
                              : String(cause),
                            { kind: "error" },
                          ),
                        );
                    }}
                  >
                    {text.copy}
                  </SecondaryButton>
                  <a
                    class="inline-flex items-center rounded-xl border border-border-base px-3 py-2 text-sm font-semibold text-text-strong"
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
            <label class="flex max-w-xs flex-col gap-2 text-sm font-medium text-text-strong">
              {text.customPort}
              <input
                class="rounded-xl border border-border-base bg-surface-base px-3 py-2 text-text-strong"
                min="1024"
                max="65535"
                type="number"
                value={customPort()}
                onInput={(event) => setCustomPort(event.currentTarget.value)}
              />
            </label>
          </Show>

          <div class="rounded-xl border border-border-base bg-surface-raised-base p-3">
            <div class="text-sm font-semibold text-text-strong">
              {phase() === "installing" || phase() === "not_installed"
                ? text.nowDoTitle
                : text.overview}
            </div>
            <ul class="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-text-weak">
              <For each={[...nowDo()]}>
                {(item) => <li>{item}</li>}
              </For>
            </ul>
          </div>

          <Show when={status()?.message || error()}>
            <p class="text-sm text-icon-critical-base" role="alert">
              {error() ?? status()?.message}
            </p>
          </Show>

          <div class="flex flex-wrap gap-2">
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
                {text.enable}
              </PrimaryButton>
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

        <Show when={showSetup}>
          <aside class="flex flex-col gap-4 rounded-2xl border border-border-base bg-surface-raised-base p-4">
            <div class="flex flex-col gap-1">
              <h3 class="text-sm font-semibold text-text-strong">
                {text.installDetails}
              </h3>
              <p class="text-sm leading-6 text-text-weak">
                {phase() === "installing"
                  ? text.phaseDescriptions.installing
                  : text.phaseDescriptions[status()?.phase ?? "not_installed"]}
              </p>
            </div>

            <dl class="flex flex-col gap-2">
              <For each={detailRows()}>
                {(row) => (
                  <div class="flex items-center justify-between gap-3 rounded-xl border border-border-weak bg-surface-base px-3 py-2.5 text-xs">
                    <dt class="text-text-weak">{row[0]}</dt>
                    <dd class="truncate font-semibold text-text-strong">
                      {row[1]}
                    </dd>
                  </div>
                )}
              </For>
            </dl>

            <div class="rounded-xl border border-border-base bg-surface-base p-3">
              <div class="text-sm font-semibold text-text-strong">
                {text.afterInstallTitle}
              </div>
              <ul class="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-text-weak">
                <For each={[...text.afterInstall]}>
                  {(item) => <li>{item}</li>}
                </For>
              </ul>
            </div>
          </aside>
        </Show>
      </div>

      <aside class="flex items-start gap-3 rounded-2xl border border-border-base bg-surface-raised-base p-4">
        <div
          aria-hidden="true"
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-interactive-base text-sm font-semibold text-text-interactive-base"
        >
          ⌀
        </div>
        <div class="flex min-w-0 flex-col gap-1">
          <h3 class="text-sm font-semibold text-text-strong">
            {text.safetyTitle}
          </h3>
          <p class="text-sm leading-6 text-text-weak">
            {phase() === "active" ? text.warning : text.warningBeforeEnable}
          </p>
        </div>
      </aside>
    </section>
  );
};

function StepMarker(props: { state: SetupStepState; index: number }) {
  if (props.state === "done") {
    return (
      <span class="relative z-10 flex h-7 w-7 items-center justify-center rounded-full border border-border-success-base bg-surface-success-base text-xs font-bold text-icon-success-base">
        ✓
      </span>
    );
  }
  if (props.state === "current") {
    return (
      <span class="relative z-10 flex h-7 w-7 items-center justify-center rounded-full bg-surface-interactive-solid text-xs font-bold text-text-on-interactive-base">
        {props.index}
      </span>
    );
  }
  return (
    <span class="relative z-10 flex h-7 w-7 items-center justify-center rounded-full border border-border-base bg-surface-base text-xs font-bold text-text-weak">
      {props.index}
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
      class="rounded-xl bg-surface-interactive-solid px-3.5 py-2 text-sm font-semibold text-text-on-interactive-base disabled:cursor-default disabled:opacity-70"
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
      class="rounded-xl border border-border-base bg-surface-base px-3.5 py-2 text-sm font-semibold text-text-strong disabled:cursor-default disabled:opacity-70"
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
      class="rounded-xl px-3.5 py-2 text-sm font-semibold text-text-weak disabled:cursor-default disabled:opacity-70"
      disabled={props.disabled}
      type="button"
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

export default Settings;
