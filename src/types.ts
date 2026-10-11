import type {
  PluginInvocationContext,
  PluginSettingsSurfaceContext,
} from "@ericsanchezok/synergy-plugin";

export type RemoteAccessPhase =
  | "not_installed"
  | "installing"
  | "signed_out"
  | "offline"
  | "ready"
  | "active"
  | "conflict"
  | "error";

export type RemoteAccessStatus = {
  provider: "tailscale";
  phase: RemoteAccessPhase;
  desiredEnabled: boolean;
  installed: boolean;
  loggedIn: boolean;
  online: boolean;
  installAttempted: boolean;
  installMode?: "automatic" | "guided";
  version?: string;
  deviceName?: string;
  tailnetName?: string;
  publicUrl?: string;
  httpsPort?: number;
  conflictPorts?: number[];
  errorCode?: string;
  message?: string;
};

export type RemoteAccessState = {
  enabled: boolean;
  httpsPort?: number;
  lastTargetFingerprint?: string;
  installAttempted: boolean;
};

export type RuntimeEndpoint = { url: string; generation: string };

export type RemoteInvocationContext = PluginInvocationContext & {
  runtimeEndpoint?: { get(): Promise<RuntimeEndpoint> };
};

export type RemoteSettingsComponentProps = {
  context: PluginSettingsSurfaceContext;
};

export type TailscalePeer = {
  id: string;
  name: string;
  dnsName: string;
  online: boolean;
};
