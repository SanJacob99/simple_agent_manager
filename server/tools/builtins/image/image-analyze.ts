import fs from 'fs/promises';
import path from 'path';
import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { Agent } from 'undici';
import { validateSafeUrl, isRestrictedAddress } from '../web/url-validator.js';

function textResult(text: string): AgentToolResult<undefined> {
  return { content: [{ type: 'text', text }], details: undefined };
}

function imageResult(text: string, mimeType: string, data: string): AgentToolResult<undefined> {
  return {
    content: [
      { type: 'image', mimeType, data },
      { type: 'text', text },
    ],
    details: undefined,
  };
}

const SUPPORTED_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

export interface ImageAnalyzeContext {
  cwd: string;
}

/**
 * Image analysis tool. Loads an image and returns it as a content block
 * so the vision-capable model can analyze it directly.
 */
export function createImageAnalyzeTool(ctx: ImageAnalyzeContext): AgentTool<TSchema> {
  return {
    name: 'image',
    description:
      'Load an image for analysis. Returns the image so you (the model) can see and describe it. ' +
      'Accepts local file paths (relative to workspace) or URLs. ' +
      'Only use this tool when you need to analyze an image — if the user already attached one, it is in the conversation.',
    label: 'Image',
    parameters: Type.Object({
      image: Type.String({
        description: 'Path to a local image file (relative to workspace) or an image URL.',
      }),
      prompt: Type.Optional(
        Type.String({ description: 'What to analyze about the image (default: describe the image)' }),
      ),
    }),
    execute: async (_toolCallId, params: any) => {
      const imagePath = params.image as string;
      const prompt = (params.prompt as string) || 'Describe this image in detail.';
      if (!imagePath?.trim()) throw new Error('No image path provided');

      // URL — fetch and return
      if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
        let currentUrl = imagePath;
        const MAX_REDIRECTS = 5;

        for (let hop = 0; ; hop++) {
          const { safeIp, safeFamily } = await validateSafeUrl(currentUrl);

          const dispatcher = new Agent({
            connect: {
              lookup: (
                _hostname: string,
                _options: unknown,
                callback: (err: Error | null, address: string, family: number) => void,
              ) => {
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

          if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status}`);
          const contentType = resp.headers.get('content-type') ?? 'image/png';
          const buffer = Buffer.from(await resp.arrayBuffer());
          return imageResult(prompt, contentType, buffer.toString('base64'));
        }
      }

      // Local file
      const resolved = path.resolve(ctx.cwd, imagePath);

      // SECURITY: Prevent Path Traversal
      if (!resolved.startsWith(ctx.cwd + path.sep) && resolved !== ctx.cwd) {
        throw new Error('Path escape detected. Access denied.');
      }

      const ext = path.extname(resolved).toLowerCase();
      const mime = SUPPORTED_MIME[ext];
      if (!mime) {
        throw new Error(`Unsupported image format: ${ext}. Supported: ${Object.keys(SUPPORTED_MIME).join(', ')}`);
      }

      try {
        const buffer = await fs.readFile(resolved);
        return imageResult(prompt, mime, buffer.toString('base64'));
      } catch {
        throw new Error(`Image not found: ${imagePath}`);
      }
    },
  };
}
