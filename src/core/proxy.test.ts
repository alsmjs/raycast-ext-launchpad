import { describe, expect, it } from "vitest";
import { parseScutilProxy, proxyEnv } from "./proxy";

/** Verbatim `scutil --proxy` output from the dev machine (Surge, HTTP+HTTPS+SOCKS). */
const FULL = `<dictionary> {
  ExceptionsList : <array> {
    0 : 127.0.0.1
    1 : 192.168.0.0/16
    2 : localhost
    3 : *.local
  }
  ExcludeSimpleHostnames : 1
  HTTPEnable : 1
  HTTPPort : 6152
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 6152
  HTTPSProxy : 127.0.0.1
  SOCKSEnable : 1
  SOCKSPort : 6153
  SOCKSProxy : 127.0.0.1
}`;

describe("parseScutilProxy", () => {
  it("reads a fully configured HTTP + HTTPS proxy", () => {
    expect(parseScutilProxy(FULL)).toEqual({
      httpsUrl: "http://127.0.0.1:6152",
      httpUrl: "http://127.0.0.1:6152",
      noProxy: "127.0.0.1,192.168.0.0/16,localhost,*.local",
    });
  });

  it("injects nothing when no proxy is enabled", () => {
    expect(parseScutilProxy("<dictionary> {\n  ExcludeSimpleHostnames : 1\n}")).toEqual({});
  });

  it("injects nothing when the settings exist but are disabled", () => {
    const raw = `<dictionary> {
  HTTPEnable : 0
  HTTPPort : 6152
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 0
  HTTPSPort : 6152
  HTTPSProxy : 127.0.0.1
}`;
    expect(parseScutilProxy(raw)).toEqual({});
  });

  // SOCKS-only is reported as "nothing to inject" on purpose: ALL_PROXY support
  // is inconsistent across HTTP clients, so we'd be promising more than we can keep.
  it("does not degrade a SOCKS-only setup into HTTPS_PROXY", () => {
    const raw = `<dictionary> {
  SOCKSEnable : 1
  SOCKSPort : 6153
  SOCKSProxy : 127.0.0.1
}`;
    expect(parseScutilProxy(raw)).toEqual({});
  });

  it("flags a PAC script rather than silently injecting nothing", () => {
    const raw = `<dictionary> {
  ProxyAutoConfigEnable : 1
  ProxyAutoConfigURLString : http://example.com/proxy.pac
}`;
    expect(parseScutilProxy(raw)).toEqual({ pacOnly: true });
  });

  it("falls back to the HTTP proxy for HTTPS when only HTTP is set", () => {
    const raw = `<dictionary> {
  HTTPEnable : 1
  HTTPPort : 8080
  HTTPProxy : proxy.local
}`;
    expect(parseScutilProxy(raw)).toMatchObject({
      httpsUrl: "http://proxy.local:8080",
      httpUrl: "http://proxy.local:8080",
    });
  });

  it("falls back to the HTTPS proxy for HTTP when only HTTPS is set", () => {
    const raw = `<dictionary> {
  HTTPSEnable : 1
  HTTPSPort : 8443
  HTTPSProxy : proxy.local
}`;
    expect(parseScutilProxy(raw)).toMatchObject({
      httpsUrl: "http://proxy.local:8443",
      httpUrl: "http://proxy.local:8443",
    });
  });

  it("ignores an enabled proxy with a missing host or port", () => {
    expect(parseScutilProxy("<dictionary> {\n  HTTPSEnable : 1\n  HTTPSPort : 6152\n}")).toEqual({});
  });

  it("omits NO_PROXY when the exceptions list is absent or empty", () => {
    const raw = `<dictionary> {
  HTTPSEnable : 1
  HTTPSPort : 6152
  HTTPSProxy : 127.0.0.1
}`;
    expect(parseScutilProxy(raw).noProxy).toBeUndefined();

    const empty = `<dictionary> {
  ExceptionsList : <array> {
  }
  HTTPSEnable : 1
  HTTPSPort : 6152
  HTTPSProxy : 127.0.0.1
}`;
    expect(parseScutilProxy(empty).noProxy).toBeUndefined();
  });

  it("does not mistake exception-list rows for scalar keys", () => {
    expect(parseScutilProxy(FULL).httpsUrl).toBe("http://127.0.0.1:6152");
  });

  it("survives empty input", () => {
    expect(parseScutilProxy("")).toEqual({});
  });
});

describe("proxyEnv", () => {
  it("maps a parsed proxy onto the conventional variables", () => {
    expect(proxyEnv(parseScutilProxy(FULL))).toEqual({
      HTTPS_PROXY: "http://127.0.0.1:6152",
      HTTP_PROXY: "http://127.0.0.1:6152",
      NO_PROXY: "127.0.0.1,192.168.0.0/16,localhost,*.local",
    });
  });

  it("yields nothing for an empty or PAC-only proxy", () => {
    expect(proxyEnv({})).toEqual({});
    expect(proxyEnv({ pacOnly: true })).toEqual({});
  });
});
