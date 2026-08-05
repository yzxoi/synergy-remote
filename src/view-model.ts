import type { RemoteAccessPhase, RemoteAccessStatus } from "./types";

export type Locale = "en" | "zh-CN";

export type SetupStepState = "done" | "current" | "pending";

export type SetupStep = {
  id: string;
  state: SetupStepState;
  title: string;
  body: string;
};

export function localeFromLanguage(language: string): Locale {
  return language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function needsCustomPort(status: RemoteAccessStatus | undefined) {
  return (
    status?.phase === "conflict" &&
    [443, 8443].every((port) => status.conflictPorts?.includes(port))
  );
}

export function canEnable(status: RemoteAccessStatus | undefined) {
  return Boolean(
    status?.installed &&
      status.loggedIn &&
      status.online &&
      status.phase !== "active",
  );
}

export function validCustomPort(value: string) {
  if (!/^\d+$/.test(value)) return false;
  const port = Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65535;
}

export function installAction(
  status: RemoteAccessStatus | undefined,
): "install" | "waiting" | "none" {
  if (!status) return "none";
  if (status.phase === "not_installed") return "install";
  if (status.phase === "installing") return "waiting";
  return "none";
}

export function installModeLabel(
  status: RemoteAccessStatus | undefined,
  locale: Locale,
) {
  const text = copy[locale];
  if (status?.installMode === "automatic") return text.installModeAutomatic;
  if (status?.installMode === "guided") return text.installModeGuided;
  return text.installModeGeneric;
}

export function setupSteps(
  status: RemoteAccessStatus | undefined,
  locale: Locale,
): SetupStep[] {
  const text = copy[locale];
  const phase = status?.phase ?? "not_installed";
  const activeIndex =
    phase === "active"
      ? 3
      : phase === "ready" || phase === "conflict" || phase === "error"
        ? 3
        : phase === "signed_out" || phase === "offline"
          ? 2
          : phase === "installing"
            ? 1
            : 0;

  return [
    {
      id: "launch",
      state: stepState(0, activeIndex, phase === "active"),
      title: text.setup.launchTitle,
      body: text.setup.launchBody,
    },
    {
      id: "install",
      state: stepState(1, activeIndex, phase === "active"),
      title: text.setup.installTitle,
      body:
        status?.installMode === "automatic"
          ? text.setup.installBodyAutomatic
          : status?.installMode === "guided"
            ? text.setup.installBodyGuided
            : text.setup.installBodyGeneric,
    },
    {
      id: "login",
      state: stepState(2, activeIndex, phase === "active"),
      title: text.setup.loginTitle,
      body: text.setup.loginBody,
    },
    {
      id: "enable",
      state: stepState(3, activeIndex, phase === "active"),
      title: text.setup.enableTitle,
      body: text.setup.enableBody,
    },
  ];
}

function stepState(
  index: number,
  activeIndex: number,
  fullyDone: boolean,
): SetupStepState {
  if (fullyDone || index < activeIndex) return "done";
  if (index === activeIndex) return "current";
  return "pending";
}

export const phaseTone: Record<
  RemoteAccessPhase,
  "muted" | "warning" | "success" | "critical"
> = {
  not_installed: "muted",
  installing: "warning",
  signed_out: "warning",
  offline: "warning",
  ready: "success",
  active: "success",
  conflict: "warning",
  error: "critical",
};

export const copy = {
  en: {
    title: "Remote Access",
    eyebrow: "Secure tailnet access",
    intro:
      "Use Tailscale Serve to reach this Synergy instance securely from other devices on the same tailnet. Install and sign in first, then enable remote access.",
    warning:
      "This address exposes the entire Synergy instance. Every user allowed by your tailnet ACL may be able to access it.",
    warningBeforeEnable:
      "Installing alone does not expose the instance. After you enable remote access, the address will expose the entire Synergy instance to users allowed by your tailnet ACL. Synergy Remote never enables Funnel.",
    safetyTitle: "Security boundary",
    status: "Status",
    overview: "Overview",
    installProgress: "Install progress",
    installDetails: "Install details",
    version: "Tailscale version",
    device: "Device",
    tailnet: "Tailnet",
    port: "HTTPS port",
    access: "Remote access",
    install: "Install Tailscale",
    login: "Open Tailscale / Sign in",
    enable: "Enable Remote Access",
    disable: "Disable",
    copy: "Copy address",
    open: "Open address",
    customPort: "Custom HTTPS port",
    refreshStatus: "Refresh status",
    waitingForTailscale: "Waiting for Tailscale…",
    retryInstall: "Reopen installer",
    installAlreadyStarted:
      "The Tailscale installer was already started. If nothing opened, use Reopen installer.",
    launched: "Tailscale flow opened",
    launchedAutomatic: "Tailscale installer opened",
    launchedGuided: "Opened the Tailscale download page",
    confirmInstallTitle: "Install Tailscale?",
    confirmInstall:
      "Synergy will start the supported platform installer or open the official Tailscale download page. System approval may be required.",
    confirmEnableTitle: "Expose this Synergy instance?",
    confirmEnable:
      "The complete instance will become reachable by users allowed by your Tailscale ACL. Synergy Remote never enables Funnel.",
    confirmDisableTitle: "Disable remote access?",
    confirmDisable:
      "Only the verified Tailscale Serve route created by Synergy Remote will be removed.",
    copied: "Remote address copied",
    cancelled: "Action cancelled",
    nowDoTitle: "What to do now",
    afterInstallTitle: "After install",
    currentPhase: "Current stage",
    installMethod: "Install method",
    client: "Tailscale client",
    polling: "Status refresh",
    clientMissing: "Not detected yet",
    clientInstalled: "Installed",
    pollingEvery: "About every 4 seconds",
    installModeAutomatic: "Automatic installer",
    installModeGuided: "Official download page",
    installModeGeneric: "System installer",
    phases: {
      not_installed: "Tailscale is not installed",
      installing: "Installing Tailscale",
      signed_out: "Sign in to Tailscale",
      offline: "Tailscale is offline",
      ready: "Ready to enable",
      active: "Remote access is active",
      conflict: "Serve port conflict",
      error: "Remote access needs attention",
    },
    phaseDescriptions: {
      not_installed:
        "Tailscale is not installed yet. Synergy Remote needs the official Tailscale client to create a private HTTPS route.",
      installing:
        "The installer is running outside Synergy. If Homebrew already downloaded Tailscale, Synergy will open the macOS package installer for you.",
      signed_out:
        "Tailscale is installed but not signed in. Open Tailscale and sign in to your tailnet.",
      offline:
        "Tailscale is installed but offline. Make sure Tailscale is running and connected.",
      ready:
        "Tailscale is ready. Enable remote access to publish the private HTTPS address.",
      active:
        "Remote access is active. Use the address below from another device in the same tailnet.",
      conflict:
        "The preferred HTTPS ports are already used by another route. Choose a free port to continue.",
      error: "Remote access needs attention. Check the message below and retry.",
    },
    nowDo: {
      not_installed: [
        "Click Install Tailscale to start the official installer.",
        "Approve any system prompts that appear.",
        "Come back here after the install finishes.",
      ],
      installing: [
        "If a macOS Installer window opened, continue through it and enter your admin password if asked.",
        "If only Terminal opened, finish any brew prompts there, then wait for the package installer.",
        "If nothing opened, click Reopen installer — Synergy will open the staged package when available.",
      ],
      signed_out: [
        "Open the Tailscale app.",
        "Sign in with the account for your tailnet.",
        "Return here once the device is online.",
      ],
      offline: [
        "Open Tailscale and make sure it is running.",
        "Confirm this computer is connected to the right tailnet.",
        "Refresh status after it comes online.",
      ],
      ready: [
        "Review the security warning below.",
        "Click Enable Remote Access to publish the private HTTPS address.",
      ],
      active: [
        "Copy or open the address from another device on the same tailnet.",
        "Disable remote access here when you no longer need it.",
      ],
      conflict: [
        "Choose a free custom HTTPS port between 1024 and 65535.",
        "Enable remote access again after selecting the port.",
      ],
      error: [
        "Read the error message below.",
        "Fix the underlying issue, then refresh status or retry the action.",
      ],
    },
    afterInstall: [
      "Open Tailscale and sign in to your account.",
      "Confirm this computer joined the correct tailnet.",
      "Come back here to enable remote access and get the private HTTPS address.",
    ],
    setup: {
      launchTitle: "Start install",
      launchBody: "Synergy opens the supported system installer flow.",
      installTitle: "Finish system install",
      installBodyAutomatic:
        "Finish the macOS package installer or Terminal prompts. Enter your admin password if asked.",
      installBodyGuided:
        "Download and install the official Tailscale client from the page that opened.",
      installBodyGeneric:
        "Complete the install steps in the system window that opened.",
      loginTitle: "Sign in to Tailscale",
      loginBody: "Open the client and join your tailnet after install finishes.",
      enableTitle: "Enable remote access",
      enableBody: "Create the private HTTPS address. Funnel stays off.",
    },
  },
  "zh-CN": {
    title: "远程访问",
    eyebrow: "安全的 tailnet 访问",
    intro:
      "用 Tailscale Serve，从同一 tailnet 的其他设备安全访问这台 Synergy。先完成安装与登录，再启用远程访问。",
    warning:
      "此地址会暴露整个 Synergy 实例。所有被 tailnet ACL 允许的用户都可能访问它。",
    warningBeforeEnable:
      "安装本身不会暴露实例。启用后，地址会把整个 Synergy 实例开放给 tailnet ACL 允许的用户。Synergy Remote 永远不会启用 Funnel。",
    safetyTitle: "启用前的安全边界",
    status: "状态",
    overview: "概览",
    installProgress: "安装进度",
    installDetails: "安装详情",
    version: "Tailscale 版本",
    device: "设备",
    tailnet: "Tailnet",
    port: "HTTPS 端口",
    access: "远程访问",
    install: "安装 Tailscale",
    login: "打开 Tailscale / 登录",
    enable: "启用远程访问",
    disable: "停用",
    copy: "复制地址",
    open: "打开地址",
    customPort: "自定义 HTTPS 端口",
    refreshStatus: "刷新状态",
    waitingForTailscale: "正在等待 Tailscale…",
    retryInstall: "重新打开安装",
    installAlreadyStarted:
      "Tailscale 安装已启动。如果没有出现安装窗口，请使用「重新打开安装」。",
    launched: "已打开 Tailscale 流程",
    launchedAutomatic: "已打开 Tailscale 安装器",
    launchedGuided: "已打开 Tailscale 下载页面",
    confirmInstallTitle: "安装 Tailscale？",
    confirmInstall:
      "Synergy 将启动当前平台支持的安装器，或打开 Tailscale 官方下载页；系统可能要求确认。",
    confirmEnableTitle: "开放此 Synergy 实例？",
    confirmEnable:
      "整个实例将允许被 Tailscale ACL 授权的用户访问。Synergy Remote 永远不会启用 Funnel。",
    confirmDisableTitle: "停用远程访问？",
    confirmDisable:
      "只会删除经核验确由 Synergy Remote 创建的 Tailscale Serve 规则。",
    copied: "远程地址已复制",
    cancelled: "操作已取消",
    nowDoTitle: "现在请做什么",
    afterInstallTitle: "装好之后",
    currentPhase: "当前阶段",
    installMethod: "安装方式",
    client: "Tailscale 客户端",
    polling: "状态刷新",
    clientMissing: "尚未检测到",
    clientInstalled: "已安装",
    pollingEvery: "约每 4 秒",
    installModeAutomatic: "Homebrew 自动安装",
    installModeGuided: "官方下载页",
    installModeGeneric: "系统安装程序",
    phases: {
      not_installed: "尚未安装 Tailscale",
      installing: "正在安装 Tailscale",
      signed_out: "请登录 Tailscale",
      offline: "Tailscale 当前离线",
      ready: "可以启用",
      active: "远程访问已启用",
      conflict: "Serve 端口冲突",
      error: "远程访问需要处理",
    },
    phaseDescriptions: {
      not_installed:
        "尚未安装 Tailscale。Synergy Remote 需要官方 Tailscale 客户端来创建私有的 HTTPS 访问地址。",
      installing:
        "安装器在 Synergy 外运行。如果 Homebrew 已经下载好安装包，Synergy 会直接打开 macOS 安装程序。",
      signed_out:
        "Tailscale 已安装但尚未登录。请打开 Tailscale 并登录到你的 tailnet。",
      offline:
        "Tailscale 已安装但当前离线。请确保 Tailscale 正在运行并已连接。",
      ready: "Tailscale 已就绪。启用远程访问即可发布私有 HTTPS 地址。",
      active: "远程访问已启用。请从同一 tailnet 中的其他设备打开下面的地址。",
      conflict: "首选 HTTPS 端口已被其他路由占用。请选择一个空闲端口继续。",
      error: "远程访问需要处理。请查看下面的错误信息并重试。",
    },
    nowDo: {
      not_installed: [
        "点击「安装 Tailscale」启动官方安装流程。",
        "按提示完成系统权限确认。",
        "安装结束后回到这里继续。",
      ],
      installing: [
        "如果弹出了 macOS 安装窗口，请继续完成安装，必要时输入管理员密码。",
        "如果只打开了 Terminal，先完成里面的 brew 提示，再等待安装包窗口。",
        "如果什么都没打开，点「重新打开安装」——若安装包已下载，Synergy 会直接打开它。",
      ],
      signed_out: [
        "打开 Tailscale 应用。",
        "使用你的账号登录对应 tailnet。",
        "设备上线后回到这里继续。",
      ],
      offline: [
        "打开 Tailscale，确认它正在运行。",
        "确认这台电脑已加入正确的 tailnet。",
        "上线后刷新状态。",
      ],
      ready: [
        "先阅读下方的安全边界说明。",
        "点击「启用远程访问」发布私有 HTTPS 地址。",
      ],
      active: [
        "从同一 tailnet 的其他设备复制或打开这个地址。",
        "不再需要时，可在这里停用远程访问。",
      ],
      conflict: [
        "选择一个 1024 到 65535 之间的空闲 HTTPS 端口。",
        "选好端口后再次启用远程访问。",
      ],
      error: [
        "先查看下方错误信息。",
        "处理问题后刷新状态，或重试对应操作。",
      ],
    },
    afterInstall: [
      "打开 Tailscale 并登录你的账号。",
      "确认这台电脑已加入正确的 tailnet。",
      "回到这里启用远程访问，获取私有 HTTPS 地址。",
    ],
    setup: {
      launchTitle: "已启动安装",
      launchBody: "Synergy 已打开系统安装流程。",
      installTitle: "完成系统安装",
      installBodyAutomatic:
        "在终端或 macOS 安装窗口里完成安装，必要时输入管理员密码。",
      installBodyGuided: "在打开的页面下载并安装官方 Tailscale 客户端。",
      installBodyGeneric: "在打开的系统窗口中完成安装步骤。",
      loginTitle: "登录 Tailscale",
      loginBody: "安装完成后打开客户端并加入 tailnet。",
      enableTitle: "启用远程访问",
      enableBody: "创建私有 HTTPS 地址，不启用 Funnel。",
    },
  },
} as const;
