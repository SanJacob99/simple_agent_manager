/**
 * `sam.json` — the manifest file at the root of a user-installed
 * tool's directory. Source of truth for both the SAM CLI (which reads
 * and writes this file via `bin/lib/manifest.js`) and the server-side
 * tool registry (which reads `disabled` to decide whether to load a
 * sibling `*.module.ts`).
 *
 * Required fields are intentionally minimal so v1 of the install flow
 * can stay simple. Other useful metadata (description, author, sha
 * pin, installedAt) is stubbed below with `// TODO:` so we can add
 * fields without churning the schema each time.
 *
 * The SAM CLI is plain ESM JS and intentionally avoids a TypeScript
 * loader, so it has its own JS-shape validator in
 * `bin/lib/manifest.js`. If the rules here change, update both.
 */

import { Type, type Static } from '@sinclair/typebox';

export const MANIFEST_FILENAME = 'sam.json';

export const UserToolManifestSchema = Type.Object({
  name: Type.String({
    minLength: 1,
    description: 'Display name. Used in `sam list tools` and as the install directory.',
  }),
  version: Type.String({
    minLength: 1,
    description: 'Free-form version string. Not validated.',
  }),
  source: Type.String({
    minLength: 1,
    description: 'Where the tool came from — typically a github.com URL.',
  }),
  disabled: Type.Boolean({
    description:
      'When true, the server skips loading any *.module.ts in this directory. Toggle with `sam enable/disable tool`.',
  }),
  // TODO: description (Type.Optional(Type.String()))
  // TODO: author      (Type.Optional(Type.String()))
  // TODO: license     (Type.Optional(Type.String()))
  // TODO: homepage    (Type.Optional(Type.String()))
  // TODO: sha         — pin a commit ref so reinstalls are reproducible
  // TODO: installedAt — ISO timestamp written by `sam install`
  // TODO: samVersion  — version of SAM that installed this tool
});

export type UserToolManifest = Static<typeof UserToolManifestSchema>;
