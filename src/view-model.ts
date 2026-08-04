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

export const phaseTone: Record<
  RemoteAccessPhase,
  "muted" | "warning" | "success" | "critical"
> = {
  not_installed: "muted",
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
    status: "Status",
    version: "Tailscale version",
    device: "Device",
    tailnet: "Tailnet",
    port: "HTTPS port",
    install: "Install Tailscale",
    login: "Open Tailscale / Sign in",
    enable: "Enable Remote Access",
    disable: "Disable",
    copy: "Copy address",
    open: "Open address",
    customPort: "Custom HTTPS port",
    retry: "Retry",
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
    launched: "Tailscale flow opened",
    phases: {
      not_installed: "Tailscale is not installed",
      signed_out: "Sign in to Tailscale",
      offline: "Tailscale is offline",
      ready: "Ready to enable",
      active: "Remote access is active",
      conflict: "Serve port conflict",
      error: "Remote access needs attention",
    },
  },
  "zh-CN": {
    title: "远程访问",
    intro: "使用 Tailscale Serve，从同一 tailnet 中的设备访问此 Synergy 实例。",
    warning:
      "此地址会暴露整个 Synergy 实例。所有被 tailnet ACL 允许的用户都可能访问它。",
    status: "状态",
    version: "Tailscale 版本",
    device: "设备",
    tailnet: "Tailnet",
    port: "HTTPS 端口",
    install: "安装 Tailscale",
    login: "打开 Tailscale / 登录",
    enable: "启用远程访问",
    disable: "停用",
    copy: "复制地址",
    open: "打开地址",
    customPort: "自定义 HTTPS 端口",
    retry: "重试",
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
    launched: "已打开 Tailscale 流程",
    phases: {
      not_installed: "尚未安装 Tailscale",
      signed_out: "请登录 Tailscale",
      offline: "Tailscale 当前离线",
      ready: "可以启用",
      active: "远程访问已启用",
      conflict: "Serve 端口冲突",
      error: "远程访问需要处理",
    },
  },
} as const;
