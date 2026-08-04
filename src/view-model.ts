import type { RemoteAccessPhase, RemoteAccessStatus } from "./types";

export type Locale = "en" | "zh-CN";

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
    intro:
      "Use Tailscale Serve to reach this Synergy instance from devices in the same tailnet.",
    warning:
      "This address exposes the entire Synergy instance. Every user allowed by your tailnet ACL may be able to access it.",
    warningBeforeEnable:
      "After you enable remote access, this address will expose the entire Synergy instance to users allowed by your tailnet ACL. Synergy Remote never enables Funnel.",
    status: "Status",
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
    retryInstall: "Retry install",
    installAlreadyStarted:
      "The Tailscale installer was already started. If it did not open, use Retry install.",
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
    phases: {
      not_installed: "Tailscale is not installed",
      installing: "Installing Tailscale…",
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
        "The Tailscale installer is running outside Synergy. Finish the steps in the window that opened, then wait for the status to update.",
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
    installingSteps: {
      automatic:
        "A terminal window opened and is installing Tailscale. If it asks for your password, enter it to continue.",
      guided:
        "The Tailscale download page opened in your browser. Download and install the official client.",
      generic:
        "The Tailscale installer started outside Synergy. Complete the install steps, then wait for the status to update.",
    },
  },
  "zh-CN": {
    title: "远程访问",
    intro: "使用 Tailscale Serve，从同一 tailnet 中的设备访问此 Synergy 实例。",
    warning:
      "此地址会暴露整个 Synergy 实例。所有被 tailnet ACL 允许的用户都可能访问它。",
    warningBeforeEnable:
      "启用远程访问后，此地址将暴露整个 Synergy 实例，所有被 tailnet ACL 允许的用户都可能访问它。Synergy Remote 永远不会启用 Funnel。",
    status: "状态",
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
    retryInstall: "重新安装",
    installAlreadyStarted:
      "Tailscale 安装已启动。如果安装窗口没有打开，请使用「重新安装」。",
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
    phases: {
      not_installed: "尚未安装 Tailscale",
      installing: "正在安装 Tailscale…",
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
        "Tailscale 安装器正在 Synergy 之外运行。请完成打开的窗口中显示的步骤，然后等待状态更新。",
      signed_out:
        "Tailscale 已安装但尚未登录。请打开 Tailscale 并登录到你的 tailnet。",
      offline:
        "Tailscale 已安装但当前离线。请确保 Tailscale 正在运行并已连接。",
      ready: "Tailscale 已就绪。启用远程访问即可发布私有 HTTPS 地址。",
      active: "远程访问已启用。请从同一 tailnet 中的其他设备打开下面的地址。",
      conflict: "首选 HTTPS 端口已被其他路由占用。请选择一个空闲端口继续。",
      error: "远程访问需要处理。请查看下面的错误信息并重试。",
    },
    installingSteps: {
      automatic:
        "已打开一个终端窗口并正在安装 Tailscale。如果它要求输入密码，请输入以继续。",
      guided: "已在浏览器中打开 Tailscale 下载页面。请下载并安装官方客户端。",
      generic:
        "Tailscale 安装程序已在 Synergy 之外启动。请完成安装步骤，然后等待状态更新。",
    },
  },
} as const;
