import fs from 'fs/promises';
import path from 'path';
import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';

const SUPPORTED_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

export interface ShowImageContext {
  cwd: string;
}

function buildResult(
  mimeType: string,
  data: string,
  caption: string,
): AgentToolResult<undefined> {
  return {
    content: [
      { type: 'image', mimeType, data },
      { type: 'text', text: caption },
    ],
    details: undefined,
  };
}

/**
 * Show an image from the filesystem (or a URL) directly in the chat.
 * Mirrors the content-block shape of image_generate so the rendered image
 * becomes a persistent part of the conversation transcript.
 */
export function createShowImageTool(ctx: ShowImageContext): AgentTool<TSchema> {
  return {
    name: 'show_image',
    description:
      'Display an image in the chat by reading it from the workspace (or fetching a URL). ' +
      'Use this when the user asks to see an image that already exists on disk — for example, ' +
      'files previously created by image_generate (under the "images/" subfolder) or any other ' +
      'image in the workspace. The image is embedded in the conversation so it stays visible.',
    label: 'Show Image',
    parameters: Type.Object({
      path: Type.String({
        description:
          'Path to a local image file (relative to the workspace, e.g. "images/foo.png") or a full http(s) URL.',
      }),
      caption: Type.Optional(
        Type.String({
          description: 'Optional caption shown alongside the image (default: the filename).',
        }),
      ),
    }),
    execute: async (_toolCallId, params: any) => {
      const imagePath = params.path as string;
      if (!imagePath?.trim()) throw new Error('No image path provided');

      const caption = (params.caption as string)?.trim() || `Showing ${imagePath}`;

      // Remote URL — fetch and embed
      if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
        const resp = await fetch(imagePath);
        if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status}`);
        const contentType = resp.headers.get('content-type') ?? 'image/png';
        const buffer = Buffer.from(await resp.arrayBuffer());
        return buildResult(contentType, buffer.toString('base64'), caption);
      }

      // Local file
      const resolved = path.resolve(ctx.cwd, imagePath);
      const ext = path.extname(resolved).toLowerCase();
      const mime = SUPPORTED_MIME[ext];
      if (!mime) {
        throw new Error(
          `Unsupported image format: ${ext}. Supported: ${Object.keys(SUPPORTED_MIME).join(', ')}`,
        );
      }

      try {
        const buffer = await fs.readFile(resolved);
        return buildResult(mime, buffer.toString('base64'), caption);
      } catch {
        throw new Error(`Image not found: ${imagePath}`);
      }
    },
  };
}
