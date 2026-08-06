import dns from 'dns';
import { Agent } from 'undici';

export const RESTRICTED_HOST_ERROR = 'Error: Access to internal or restricted hosts is not permitted.';

export function isRestrictedAddress(rawAddress: string): boolean {
  let address = rawAddress.toLowerCase();
  const zoneIdx = address.indexOf('%');
  if (zoneIdx !== -1) address = address.slice(0, zoneIdx);

  const mappedMatch = address.match(/^(?:::ffff:|::)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  const v4 = mappedMatch ? mappedMatch[1] : address;

  const isRestrictedV4 =
    v4 === '0.0.0.0' ||
    v4 === '127.0.0.1' ||
    v4 === '169.254.169.254' ||
    /^0\./.test(v4) ||
    /^10\./.test(v4) ||
    /^127\./.test(v4) ||
    /^169\.254\./.test(v4) ||
    /^192\.168\./.test(v4) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(v4) ||
    /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./.test(v4);

  if (isRestrictedV4) return true;
  if (mappedMatch) return false;

  const isRestrictedV6 =
    address === '::1' ||
    address === '::' ||
    /^f[cd]/.test(address) ||
    /^fe[89ab]/.test(address) ||
    /^fe[c-f]/.test(address);

  return isRestrictedV6;
}

export async function fetchSafeUrl(url: string, init?: RequestInit): Promise<Response> {
  const MAX_REDIRECTS = 5;
  let currentUrl = url;

  for (let hop = 0; ; hop++) {
    const parsedUrl = new URL(currentUrl);

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error('Error: Invalid URL protocol. Only http and https are allowed.');
    }

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

    let records;
    try {
      records = await dns.promises.lookup(hostname, { all: true });
    } catch (err) {
      throw new Error(`Error resolving hostname: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
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

    const safeIp = pinnedIp as string;
    const safeFamily = pinnedFamily;
    const dispatcher = new Agent({
      connect: {
        lookup: (_hostname, _options, callback) => {
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
        if (hop >= MAX_REDIRECTS) {
          throw new Error(`Fetch error: too many redirects (>${MAX_REDIRECTS})`);
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }
    }

    return resp;
  }
}
