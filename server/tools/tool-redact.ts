const REDACT_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/\-]{8,}=*/gi,
  /\b(sk-[A-Za-z0-9_\-]{16,})\b/g,
  /\b(ghp_[A-Za-z0-9]{20,})\b/g,
  /\b(gho_[A-Za-z0-9]{20,})\b/g,
  /\b(xox[baprs]-[A-Za-z0-9\-]{10,})\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b[A-Za-z0-9_\-]{32,}\b/g,
];

function maskValue(value: string): string {
  if (value.length >= 18) {
    return `${value.slice(0, 6)}…${value.slice(-4)}`;
  }
  return '***';
}

export function redactToolDetail(text: string): string {
  if (!text) return text;
  let out = text;
  for (const pattern of REDACT_PATTERNS) {
    out = out.replace(pattern, (match) => maskValue(match));
  }
  return out;
}

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function sanitizeForConsole(text: string | undefined, maxChars = 600): string {
  if (text === undefined || text === null) return '';
  let out = String(text).replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();
  if (out.length > maxChars) {
    out = out.slice(0, maxChars - 1) + '…';
  }
  return out;
}

function serializeToolParams(value: unknown): string {
  if (value === undefined) return '<undefined>';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'function') {
    return value.name ? `[Function ${value.name}]` : '[Function anonymous]';
  }
  if (typeof value === 'symbol') {
    return value.description ? `Symbol(${value.description})` : 'Symbol()';
  }
  try {
    const json = JSON.stringify(value);
    if (typeof json === 'string') return json;
  } catch {
    // circular or non-serializable — fall through
  }
  return Object.prototype.toString.call(value);
}

export function formatToolParamPreview(label: string, value: unknown, maxChars = 600): string {
  const serialized = serializeToolParams(value);
  const redacted = redactToolDetail(serialized);
  const preview = sanitizeForConsole(redacted, maxChars) || '<empty>';
  return `${label}=${preview}`;
}
