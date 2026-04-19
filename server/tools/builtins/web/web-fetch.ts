import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import dns from 'dns';

function textResult(text: string): AgentToolResult<undefined> {
  return { content: [{ type: 'text', text }], details: undefined };
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
        // SECURITY: Prevent Server-Side Request Forgery (SSRF)
        const parsedUrl = new URL(params.url);

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
          return textResult('Error: Access to internal or restricted hosts is not permitted.');
        }

        // Perform DNS lookup and check resolved IP
        try {
          // Use { all: true } to check ALL records returned by DNS to prevent multiple-A-record bypass
          const records = await dns.promises.lookup(hostname, { all: true });
          let selectedSafeIp: string | null = null;

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
              return textResult('Error: Access to internal or restricted hosts is not permitted.');
            }

            if (!selectedSafeIp && record.family === 4) {
              selectedSafeIp = address;
            }
          }

        } catch (err) {
          return textResult(`Error resolving hostname: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }

        // Note: For full TOCTOU/DNS Rebinding protection, an HTTP Agent or custom
        // dispatcher (e.g. undici) overriding the connection socket is required to
        // pin the validated IP while retaining standard SNI for TLS.
        // For now, we perform the validation lookup and rely on the OS DNS cache.
        const resp = await fetch(params.url, {
          method: params.method || 'GET',
          signal,
        });
        const raw = await resp.text();
        const contentType = resp.headers.get('content-type');
        const body = isHtmlResponse(contentType, raw) ? htmlToText(raw) : raw;
        const truncated = body.length > 10000 ? body.slice(0, 10000) + '\n...(truncated)' : body;
        return textResult(`Status: ${resp.status}\n\n${truncated}`);
      } catch (e) {
        return textResult(`Fetch error: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    },
  };
}
