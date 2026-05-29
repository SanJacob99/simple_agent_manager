import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import dns from 'dns';
import { Agent } from 'undici';

function textResult(text: string): AgentToolResult<undefined> {
  return { content: [{ type: 'text', text }], details: undefined };
}

const RESTRICTED_HOST_ERROR = 'Error: Access to internal or restricted hosts is not permitted.';

/**
 * Returns true if the given resolved IP address is private, internal, reserved,
 * or otherwise unsafe to connect to. Covers IPv4 ranges, IPv6 ranges, and
 * IPv4-mapped IPv6 forms of the IPv4 ranges.
 */
function isRestrictedAddress(rawAddress: string): boolean {
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

  // If we normalized a mapped IPv4 form, the v4 rules above are authoritative.
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
 * Convert HTML to readable plain text. Strips tags, decodes common entities,
 * removes non-visible elements (script, style, head), and collapses whitespace.
 */
function htmlToText(html: string): string {
  let text = html;
  // Remove script, style, head, and noscript blocks entirely
  text = text.replace(/<(script|style|head|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  // Convert block-level elements to newlines
  text = text.replace(/<\/(p|div|li|tr|h[1-6]|blockquote|section|article|header|footer|nav|main)>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/td>/gi, '\t');
  // Strip all remaining tags
  text = text.replace(/<[^>]+>/g, '');
  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
  // Collapse whitespace: multiple spaces/tabs to single space, multiple newlines to double
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n[ \t]+/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

function isHtmlResponse(contentType: string | null, body: string): boolean {
  if (contentType && /text\/html|application\/xhtml/i.test(contentType)) return true;
  // Fallback: sniff the first 200 chars for a doctype or html tag
  const head = body.slice(0, 200).trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
}

export function createWebFetchTool(): AgentTool<TSchema> {
  return {
    name: 'web_fetch',
    description: 'Fetch content from a URL. Returns plain text; HTML pages are automatically converted to readable text.',
    label: 'Web Fetch',
    parameters: Type.Object({
      url: Type.String({ description: 'URL to fetch' }),
      method: Type.Optional(Type.String({ description: 'HTTP method (default: GET)' })),
    }),
    execute: async (_id, params: any, signal) => {
      try {
        const MAX_REDIRECTS = 5;
        let currentUrl = params.url;

        for (let hop = 0; ; hop++) {
          // SECURITY: Prevent Server-Side Request Forgery (SSRF)
          const parsedUrl = new URL(currentUrl);

          // Enforce valid protocols
          if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            return textResult('Error: Invalid URL protocol. Only http and https are allowed.');
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
            return textResult(RESTRICTED_HOST_ERROR);
          }

          // Perform DNS lookup and validate EVERY resolved address. Reject if ANY
          // resolved address is private/internal, and remember a safe IP to pin.
          let pinnedIp: string | null = null;
          let pinnedFamily = 4;
          try {
            // { all: true } checks ALL records to prevent multiple-A-record bypass.
            const records = await dns.promises.lookup(hostname, { all: true });
            if (records.length === 0) {
              return textResult(`Error resolving hostname: no addresses found for ${hostname}`);
            }

            for (const record of records) {
              if (isRestrictedAddress(record.address)) {
                return textResult(RESTRICTED_HOST_ERROR);
              }
              if (!pinnedIp) {
                pinnedIp = record.address;
                pinnedFamily = record.family;
              }
            }
          } catch (err) {
            return textResult(`Error resolving hostname: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }

          // PIN the validated IP. We supply a custom lookup to the undici dispatcher
          // that ALWAYS returns the address we already validated, so the actual
          // connection cannot be re-resolved to a different (internal) IP between
          // our check and the connect (DNS-rebinding TOCTOU). TLS SNI / certificate
          // validation still uses the original hostname because undici connects with
          // the original servername; only the resolved address is overridden.
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
              method: params.method || 'GET',
              signal,
              // Disable automatic redirect following: a redirect to an internal
              // host is the same SSRF attack, so we follow manually and re-validate
              // each hop above.
              redirect: 'manual',
              // `dispatcher` is a Node/undici fetch extension not present in the
              // DOM `RequestInit` lib types, so the options object is widened.
              dispatcher,
            } as RequestInit & { dispatcher: unknown });
          } finally {
            // Best-effort cleanup of the per-request dispatcher.
            void dispatcher.close().catch(() => {});
          }

          // Handle redirects manually so each hop's target host is validated.
          if (resp.status >= 300 && resp.status < 400) {
            const location = resp.headers.get('location');
            if (location) {
              if (hop >= MAX_REDIRECTS) {
                return textResult(`Fetch error: too many redirects (>${MAX_REDIRECTS})`);
              }
              currentUrl = new URL(location, currentUrl).toString();
              continue;
            }
          }

          const raw = await resp.text();
          const contentType = resp.headers.get('content-type');
          const body = isHtmlResponse(contentType, raw) ? htmlToText(raw) : raw;
          const truncated = body.length > 10000 ? body.slice(0, 10000) + '\n...(truncated)' : body;
          return textResult(`Status: ${resp.status}\n\n${truncated}`);
        }
      } catch (e) {
        return textResult(`Fetch error: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    },
  };
}
