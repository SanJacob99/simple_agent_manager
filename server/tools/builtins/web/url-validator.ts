import dns from 'dns';

export async function validateSafeUrl(urlString: string): Promise<string> {
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
    throw new Error('Error: Access to internal or restricted hosts is not permitted.');
  }

  try {
    const records = await dns.promises.lookup(hostname, { all: true });

    for (const record of records) {
      const address = record.address;
      const isRestrictedV4 =
        address === '127.0.0.1' ||
        address === '0.0.0.0' ||
        address === '169.254.169.254' ||
        address.startsWith('10.') ||
        address.startsWith('192.168.') ||
        address.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./) || // 172.16.0.0/12
        address.match(/^127\./) || // 127.0.0.0/8
        address.match(/^169\.254\./); // 169.254.0.0/16

      const isRestrictedV6 =
        address === '::1' ||
        address === '::' ||
        address.toLowerCase().startsWith('fc') || // ULA
        address.toLowerCase().startsWith('fd') || // ULA
        address.toLowerCase().startsWith('fe8') || // Link-local
        address.toLowerCase().startsWith('fe9') || // Link-local
        address.toLowerCase().startsWith('fea') || // Link-local
        address.toLowerCase().startsWith('feb') || // Link-local
        address.toLowerCase().startsWith('::ffff:'); // IPv4 mapped

      if (isRestrictedV4 || isRestrictedV6) {
        throw new Error('Error: Access to internal or restricted hosts is not permitted.');
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Error:')) {
      throw err;
    }
    throw new Error(`Error resolving hostname: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  return urlString;
}
