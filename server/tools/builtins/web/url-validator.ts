import dns from 'dns';
import { Agent } from 'undici';

export const RESTRICTED_HOST_ERROR = 'Error: Access to internal or restricted hosts is not permitted.';

/**
 * Returns true if the given resolved IP address is private, internal, reserved,
 * or otherwise unsafe to connect to. Covers IPv4 ranges, IPv6 ranges, and
 * IPv4-mapped IPv6 forms of the IPv4 ranges.
 */
export function isRestrictedAddress(rawAddress: string): boolean {
  let address = rawAddress.toLowerCase();
  // Strip IPv6 zone index (e.g. fe80::1%eth0)
  const zoneIdx = address.indexOf('%');
  if (zoneIdx !== -1) address = address.slice(0, zoneIdx);

  // Normalize IPv4-mapped / IPv4-compatible IPv6 forms (e.g. ::ffff:127.0.0.1)
  // to the embedded IPv4 address so the IPv4 rules below catch them too.
  const mappedMatch = address.match(/^(?:::ffff:|::)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  const v4 = mappedMatch ? mappedMatch[1] : address;

  const isRestrictedV4 =
    v4 === '0.0.0.0' ||
    v4 === '127.0.0.1' ||
    v4 === '169.254.169.254' ||
    /^0\./.test(v4) || // 0.0.0.0/8 ("this network")
    /^10\./.test(v4) || // 10.0.0.0/8 private
    /^127\./.test(v4) || // 127.0.0.0/8 loopback
    /^169\.254\./.test(v4) || // 169.254.0.0/16 link-local
    /^192\.168\./.test(v4) || // 192.168.0.0/16 private
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(v4) || // 172.16.0.0/12 private
    /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./.test(v4); // 100.64.0.0/10 CGNAT

  if (isRestrictedV4) return true;

  if (mappedMatch) return false;

  const isRestrictedV6 =
    address === '::1' || // loopback
    address === '::' || // unspecified
    /^f[cd]/.test(address) || // fc00::/7 unique-local (fc.. / fd..)
    /^fe[89ab]/.test(address) || // fe80::/10 link-local (fe8.. - feb..)
    /^fe[c-f]/.test(address); // fec0::/10 deprecated site-local (legacy)

  return isRestrictedV6;
}

/**
 * Validates a URL against SSRF and returns a fetch response using undici Agent
 * that pins the validated IP.
 */
export async function fetchSafeUrl(url: string, init?: RequestInit, maxRedirects: number = 5): Promise<Response> {
    let currentUrl = url;
    for (let hop = 0; hop <= maxRedirects; hop++) {
        const parsedUrl = new URL(currentUrl);

        // Enforce valid protocols
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            throw new Error('Error: Invalid URL protocol. Only http and https are allowed.');
        }

        // Block internal and reserved IP addresses/hostnames
        const hostname = parsedUrl.hostname.toLowerCase();
        if (
            hostname === 'localhost' ||
            hostname === '127.0.0.1' ||
            hostname === '0.0.0.0' ||
            hostname === '::1' ||
            hostname === '169.254.169.254' ||
            hostname.endsWith('.internal') ||
            hostname.endsWith('.local')
        ) {
            throw new Error(RESTRICTED_HOST_ERROR);
        }

        let pinnedIp: string | null = null;
        let pinnedFamily = 4;
        try {
            const records = await dns.promises.lookup(hostname, { all: true });
            if (records.length === 0) {
                throw new Error(`Error resolving hostname: no addresses found for ${hostname}`);
            }

            for (const record of records) {
                if (isRestrictedAddress(record.address)) {
                    throw new Error(RESTRICTED_HOST_ERROR);
                }
                if (!pinnedIp) {
                    pinnedIp = record.address;
                    pinnedFamily = record.family;
                }
            }
        } catch (err) {
            throw new Error(`Error resolving hostname: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }

        const safeIp = pinnedIp as string;
        const safeFamily = pinnedFamily;
        const dispatcher = new Agent({
            connect: {
                lookup: (
                    _hostname: string,
                    _options: unknown,
                    callback: (err: Error | null, address: string, family: number) => void,
                ) => {
                    // Re-validate defensively before handing back the pinned address.
                    if (isRestrictedAddress(safeIp)) {
                        callback(new Error('restricted address'), '', 0);
                        return;
                    }
                    callback(null, safeIp, safeFamily);
                },
            },
        });

        let resp: Response;
        try {
            resp = await fetch(currentUrl, {
                ...init,
                redirect: 'manual',
                dispatcher,
            } as RequestInit & { dispatcher: unknown });
        } finally {
            void dispatcher.close().catch(() => {});
        }

        if (resp.status >= 300 && resp.status < 400) {
            const location = resp.headers.get('location');
            if (location) {
                if (hop >= maxRedirects) {
                    throw new Error(`Fetch error: too many redirects (>${maxRedirects})`);
                }
                currentUrl = new URL(location, currentUrl).toString();
                continue;
            }
        }
        return resp;
    }
    throw new Error('Unreachable');
}
