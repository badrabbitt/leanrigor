/**
 * Host and Origin validation for the local HTTP transport.
 *
 * A gateway bound to loopback without TLS or authentication is reachable from
 * any web page the user visits, if that page's DNS resolves to 127.0.0.1. The
 * only thing distinguishing such a request from a legitimate one is the Host
 * and Origin headers, so both are checked.
 *
 * See the MCP TypeScript SDK advisory GHSA-w48q-cv73-mx4w.
 */

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function hostnameOf(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;

  // Bracketed IPv6, with or without a port.
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(trimmed);
  if (bracketed) return bracketed[1]!.toLowerCase();

  // A bare host[:port] has no scheme, so give it one before parsing.
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
    return url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return undefined;
  }
}

export function isLoopbackHostname(value: string | undefined): boolean {
  if (value === undefined) return false;
  const hostname = hostnameOf(value);
  return hostname !== undefined && LOOPBACK_HOSTNAMES.has(hostname);
}

export interface HostGuardHeaders {
  readonly host?: string | string[] | undefined;
  readonly origin?: string | string[] | undefined;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Decides whether a request to the loopback-bound gateway may proceed.
 *
 * A missing Origin is allowed — non-browser clients do not send one — but a
 * present Origin must be a loopback origin, and the Host header must always be
 * a loopback host. `allowedHosts` lets an operator opt into a different binding
 * deliberately.
 */
export function isRequestAllowed(
  headers: HostGuardHeaders,
  allowedHosts: readonly string[] = [],
): boolean {
  const host = first(headers.host);
  const origin = first(headers.origin);

  const extra = new Set(allowedHosts.map((value) => hostnameOf(value) ?? value.toLowerCase()));
  const permitted = (value: string | undefined): boolean => {
    if (value === undefined) return false;
    if (isLoopbackHostname(value)) return true;
    const hostname = hostnameOf(value);
    return hostname !== undefined && extra.has(hostname);
  };

  if (!permitted(host)) return false;
  if (origin !== undefined && !permitted(origin)) return false;
  return true;
}
