/**
 * Scaffold a user-installed tool at
 * `server/tools/user/<name>/<name>.module.ts`.
 *
 *     npm run scaffold:tool -- weather
 *
 * What this does:
 *   - Validates the name is snake_case so it can be a legal tool name.
 *   - Refuses to overwrite an existing user-tools directory.
 *   - Refuses names that collide with a built-in (flat list below —
 *     kept in sync by eye; the server itself also enforces this at
 *     load time, so a stale list here only means a late failure).
 *   - Writes a minimal, runnable `ToolModule` the user can iterate on.
 *
 * The generated tool imports `defineTool` from the vendored SDK surface
 * (`server/tools/sdk.ts`) rather than `tool-module.ts` directly, so
 * future internal refactors don't break user tools.
 *
 * Related doc: docs/concepts/user-tools-guide.md — authoring
 * walkthrough plus the design notes (loader, UI integration,
 * stability contract) at the bottom.
 */

import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USER_TOOLS_DIR = path.join(REPO_ROOT, 'server', 'tools', 'user');

// Names the server built-ins claim. A user tool with one of these
// names loads silently (the registry logs a collision warning and
// drops it). Blocking here gives authors a clearer message upfront.
const BUILTIN_NAMES = new Set<string>([
  'exec',
  'bash',
  'calculator',
  'code_execution',
  'code_interpreter',
  'read_file',
  'write_file',
  'edit_file',
  'list_directory',
  'apply_patch',
  'web_search',
  'web_fetch',
  'browser',
  'canva',
  'image',
  'image_generate',
  'show_image',
  'send_message',
  'text_to_speech',
  'ask_user',
  'confirm_action',
  'music_generate',
  'sessions_list',
  'sessions_history',
  'sessions_send',
  'sessions_spawn',
  'sessions_yield',
  'subagents',
  'session_status',
]);

function die(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function validateName(raw: string): string {
  const name = raw.trim();
  if (!name) die('tool name is required. Example: npm run scaffold:tool -- weather');
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    die(
      `invalid name "${name}". Tool names must be snake_case: start with a lowercase letter, ` +
        `followed by lowercase letters, digits, or underscores.`,
    );
  }
  if (BUILTIN_NAMES.has(name)) {
    die(
      `"${name}" collides with a built-in tool name. Pick a different name — ` +
        `user tools cannot override built-ins.`,
    );
  }
  return name;
}

function template(name: string): string {
  const pascal = name
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  return `import { Type } from '@sinclair/typebox';
import { defineTool } from '../../sdk';

/**
 * ${pascal} tool — user-installed.
 *
 * Loaded by the filesystem-scan registry at server startup (see
 * docs/concepts/user-tools-guide.md). Restart the server after editing.
 */
export default defineTool<void>({
  name: '${name}',
  label: '${pascal}',
  description:
    'TODO: one-line, model-facing description. Say WHEN to use this and ' +
    'WHEN NOT to. Small models rely on this to pick between tools.',
  // Optional. Matches a key in shared/resolve-tool-names.ts → TOOL_GROUPS.
  // Leave unset for now; the tool will appear under "other" in the picker.
  // group: 'custom',
  classification: 'read-only',

  resolveContext: () => undefined,

  create: () => ({
    name: '${name}',
    label: '${pascal}',
    description:
      'TODO: one-line, model-facing description. Say WHEN to use this and ' +
      'WHEN NOT to. Small models rely on this to pick between tools.',
    parameters: Type.Object({
      input: Type.String({
        description: 'Replace this field with the real parameters the tool needs.',
      }),
    }),
    execute: async (_toolCallId, params) => {
      // TODO: real work goes here.
      return {
        content: [
          {
            type: 'text' as const,
            text: \`${name} received: \${JSON.stringify(params)}\`,
          },
        ],
        details: { ok: true },
      };
    },
  }),
});
`;
}

function main(): void {
  const [, , rawName] = process.argv;
  if (!rawName) {
    die('missing name. Usage: npm run scaffold:tool -- <snake_case_name>');
  }
  const name = validateName(rawName);

  const toolDir = path.join(USER_TOOLS_DIR, name);
  const toolFile = path.join(toolDir, `${name}.module.ts`);

  if (fs.existsSync(toolDir)) {
    die(
      `"${toolDir}" already exists. Remove it first if you intended to regenerate, ` +
        `or pick a different name.`,
    );
  }

  fs.mkdirSync(toolDir, { recursive: true });
  fs.writeFileSync(toolFile, template(name), 'utf8');

  const rel = path.relative(REPO_ROOT, toolFile);
  console.log(`created ${rel}`);
  console.log('');
  console.log('next steps:');
  console.log(`  1. Edit ${rel} — fill in parameters and execute().`);
  console.log('  2. Restart the server (npm run dev:server).');
  console.log('  3. Open the Tools node, enable the new tool, and use it.');
  console.log('');
  console.log('docs: docs/concepts/user-tools-guide.md');
}

main();
