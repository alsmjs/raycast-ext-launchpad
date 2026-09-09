/**
 * Parser for `scutil --proxy` output.
 *
 * Why this exists at all: Chromium, NSURLSession and friends read the macOS
 * system proxy, but anything built on Rust reqwest / Go net/http / Python
 * requests only ever looks at HTTPS_PROXY & co. Discord's updater is the
 * concrete case — its `updater.node` is reqwest-based, so it ignores the system
 * proxy entirely and hangs. Reading the system setting here lets us hand those
 * apps the environment variables they actually understand.
 */

export interface SystemProxy {
  /** Value for HTTPS_PROXY. */
  httpsUrl?: string;
  /** Value for HTTP_PROXY. */
  httpUrl?: string;
  /** Value for NO_PROXY, comma-separated. */
  noProxy?: string;
  /**
   * The system is on a PAC script, which can't be reduced to a single
   * host:port. Callers must say so out loud rather than silently injecting
   * nothing.
   */
  pacOnly?: boolean;
}

/**
 * Sample output (verified on macOS 26):
 *
 *   <dictionary> {
 *     ExceptionsList : <array> {
 *       0 : 127.0.0.1
 *       1 : *.local
 *     }
 *     HTTPEnable : 1
 *     HTTPPort : 6152
 *     HTTPProxy : 127.0.0.1
 *     HTTPSEnable : 1
 *     ...
 *   }
 */
export function parseScutilProxy(raw: string): SystemProxy {
  // Only top-level scalars. ExceptionsList is a nested <array> and is parsed
  // separately — a generic key lookup would otherwise match its numbered rows.
  const pick = (key: string): string | undefined => raw.match(new RegExp(`^\\s*${key}\\s*:\\s*(\\S+)\\s*$`, "m"))?.[1];

  const build = (enable: string, host: string, port: string): string | undefined => {
    if (pick(enable) !== "1") return undefined;
    const h = pick(host);
    const p = pick(port);
    return h && p ? `http://${h}:${p}` : undefined;
  };

  const httpsUrl = build("HTTPSEnable", "HTTPSProxy", "HTTPSPort");
  const httpUrl = build("HTTPEnable", "HTTPProxy", "HTTPPort");

  if (!httpsUrl && !httpUrl) {
    // SOCKS is deliberately not degraded into HTTPS_PROXY: ALL_PROXY=socks5://
    // support varies wildly between HTTP clients, so claiming success would be
    // a lie for a good share of apps.
    return pick("ProxyAutoConfigEnable") === "1" ? { pacOnly: true } : {};
  }

  const result: SystemProxy = {
    // An HTTP proxy tunnels https:// fine via CONNECT, so either one can stand
    // in for the other when only one is configured.
    httpsUrl: httpsUrl ?? httpUrl,
    httpUrl: httpUrl ?? httpsUrl,
  };
  const noProxy = parseExceptionsList(raw);
  if (noProxy) result.noProxy = noProxy;
  return result;
}

function parseExceptionsList(raw: string): string | undefined {
  const block = raw.match(/ExceptionsList\s*:\s*<array>\s*\{([\s\S]*?)\n\s*\}/);
  if (!block) return undefined;
  const items = [...block[1].matchAll(/^\s*\d+\s*:\s*(\S+)\s*$/gm)].map((m) => m[1]);
  return items.length ? items.join(",") : undefined;
}

/**
 * Build the variables to inject. Returns an empty object when there is nothing
 * usable — injecting a blank or placeholder value is worse than injecting
 * nothing, because the target app would believe a proxy exists and fail to
 * connect through it.
 */
export function proxyEnv(proxy: SystemProxy): Record<string, string> {
  const env: Record<string, string> = {};
  if (proxy.httpsUrl) env.HTTPS_PROXY = proxy.httpsUrl;
  if (proxy.httpUrl) env.HTTP_PROXY = proxy.httpUrl;
  if (proxy.noProxy) env.NO_PROXY = proxy.noProxy;
  return env;
}
