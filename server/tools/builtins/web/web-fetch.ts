import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { Agent } from 'undici';
import { validateSafeUrl, isRestrictedAddress } from './url-validator.js';

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
        const MAX_REDIRECTS = 5;
        let currentUrl = params.url;

        for (let hop = 0; ; hop++) {
          // SECURITY: Prevent Server-Side Request Forgery (SSRF)
          const { safeIp, safeFamily } = await validateSafeUrl(currentUrl);

          // PIN the validated IP. We supply a custom lookup to the undici dispatcher
          // that ALWAYS returns the address we already validated, so the actual
          // connection cannot be re-resolved to a different (internal) IP between
          // our check and the connect (DNS-rebinding TOCTOU). TLS SNI / certificate
          // validation still uses the original hostname because undici connects with
          // the original servername; only the resolved address is overridden.
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
        return textResult(`${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    },
  };
}
