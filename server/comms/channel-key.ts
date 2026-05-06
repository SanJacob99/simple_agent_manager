const PREFIX = 'channel:';

export function canonicalChannelKey(a: string, b: string): string {
  if (a === b) throw new Error('canonicalChannelKey: agent IDs must differ');
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return `${PREFIX}${lo}:${hi}`;
}

export function parseChannelKey(key: string): [string, string] {
  if (!key.startsWith(PREFIX)) throw new Error(`not a channel key: ${key}`);
  const rest = key.slice(PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep < 0) throw new Error(`malformed channel key: ${key}`);
  return [rest.slice(0, sep), rest.slice(sep + 1)];
}

export function isChannelKey(key: string): boolean {
  return key.startsWith(PREFIX) && key.slice(PREFIX.length).includes(':');
}
