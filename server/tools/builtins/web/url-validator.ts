import dns from 'dns';

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

export async function validateSafeUrl(urlString: string): Promise<{ safeIp: string, safeFamily: number, parsedUrl: URL }> {
  const parsedUrl = new URL(urlString);

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

  const records = await dns.promises.lookup(hostname, { all: true });
  if (records.length === 0) {
    throw new Error(`Error resolving hostname: no addresses found for ${hostname}`);
  }

  let pinnedIp: string | null = null;
  let pinnedFamily = 4;

  for (const record of records) {
    if (isRestrictedAddress(record.address)) {
      throw new Error(RESTRICTED_HOST_ERROR);
    }
    if (!pinnedIp) {
      pinnedIp = record.address;
      pinnedFamily = record.family;
    }
  }

  return { safeIp: pinnedIp!, safeFamily: pinnedFamily, parsedUrl };
}
