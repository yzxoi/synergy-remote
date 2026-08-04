export type ServeRoute = {
  port: number;
  target?: string;
  funnel: boolean;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function parseObject(value: string): Record<string, unknown> {
  try {
    return record(JSON.parse(value)) ?? {};
  } catch {
    return {};
  }
}

export function stringAt(
  input: Record<string, unknown>,
  ...path: string[]
): string | undefined {
  let current: unknown = input;
  for (const key of path) current = record(current)?.[key];
  return typeof current === "string" ? current : undefined;
}

function portFromKey(value: string): number | undefined {
  const match = value.match(/:(\d+)(?:\/)?$/);
  const port = match ? Number(match[1]) : Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
}

function proxyFromHandlers(value: unknown): string | undefined {
  const handlers = record(value);
  if (!handlers) return undefined;
  for (const handler of Object.values(handlers)) {
    const item = record(handler);
    const proxy = item?.Proxy ?? item?.proxy ?? item?.Target ?? item?.target;
    if (typeof proxy === "string") return proxy;
  }
}

export function parseServeRoutes(
  input: Record<string, unknown>,
): Map<number, ServeRoute> {
  const routes = new Map<number, ServeRoute>();
  const funnel = record(input.AllowFunnel) ?? record(input.Funnel) ?? {};
  const web = record(input.Web) ?? record(input.web) ?? {};
  for (const [key, value] of Object.entries(web)) {
    const port = portFromKey(key);
    if (!port) continue;
    const item = record(value);
    const target = proxyFromHandlers(item?.Handlers ?? item?.handlers ?? item);
    const funnelEnabled = Object.keys(funnel).some(
      (candidate) => portFromKey(candidate) === port,
    );
    routes.set(port, {
      port,
      ...(target ? { target } : {}),
      funnel: funnelEnabled,
    });
  }

  const services = record(input.Services) ?? record(input.services) ?? {};
  for (const value of Object.values(services)) {
    const service = record(value);
    const tcp = record(service?.TCP) ?? record(service?.tcp) ?? {};
    const serviceWeb = record(service?.Web) ?? record(service?.web) ?? {};
    for (const [key, webValue] of Object.entries(serviceWeb)) {
      const port = portFromKey(key);
      if (!port || routes.has(port)) continue;
      const item = record(webValue);
      const target = proxyFromHandlers(
        item?.Handlers ?? item?.handlers ?? item,
      );
      routes.set(port, { port, ...(target ? { target } : {}), funnel: false });
    }
    for (const key of Object.keys(tcp)) {
      const port = portFromKey(key);
      if (port && !routes.has(port)) routes.set(port, { port, funnel: false });
    }
  }
  return routes;
}
