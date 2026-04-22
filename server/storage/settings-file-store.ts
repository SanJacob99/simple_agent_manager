import fs from 'fs/promises';
import path from 'path';

const DEFAULT_DIR = process.cwd();
const SETTINGS_FILE = 'settings.json';

/**
 * Default policy text injected into every agent system prompt whose Tools
 * node has `ask_user` or `confirm_action` enabled. Worded to hit hard on
 * smaller/older models that skim descriptions, and covers the
 * "one-tool-call-per-confirm-turn" rule that keeps parallel-tool-calling
 * providers (Claude 3.5+, GPT-4-turbo) from bypassing the gate.
 *
 * Three runtime placeholders — `{{READ_ONLY_TOOLS}}`,
 * `{{STATE_MUTATING_TOOLS}}`, `{{DESTRUCTIVE_TOOLS}}` — are substituted
 * by the agent runtime with the resolved tool list grouped by each
 * module's `classification`. Users who edit their policy can strip the
 * placeholders to fall back to a static (non-class-aware) policy.
 */
export const DEFAULT_CONFIRMATION_POLICY = `## Confirmation policy

Tools are grouped by safety class. Your confirmation obligations differ per class:

- **Read-only** tools do not write files, spend money, mutate shared state, or contact third parties on the user's behalf. You MAY call them without a prior \`confirm_action\`. Read-only tools: {{READ_ONLY_TOOLS}}
- **State-mutating** tools write files, produce media, run code, or emit user-visible side effects. You MUST precede each call with a \`confirm_action\` in a dedicated turn. State-mutating tools: {{STATE_MUTATING_TOOLS}}
- **Destructive** tools can overwrite, delete, or otherwise make hard-to-reverse changes. You MUST precede each call with a \`confirm_action\` whose question names the specific target — exact command, path, or resource — you are about to touch. Destructive tools: {{DESTRUCTIVE_TOOLS}}

RULES:
1. When a confirmation is required, it MUST be the ONLY tool call in that turn. Do NOT emit any other tool call alongside \`confirm_action\` — wait for the answer, then act on it in your next turn.
2. If the answer is "no" or the call is cancelled/timed out, you MUST abandon the action. Report what you would have done and stop.
3. If you need freeform input from the user (not yes/no), call \`ask_user\` instead — this also satisfies the gate for the subsequent action you described.
4. You do NOT need confirmation for calling \`ask_user\` or \`confirm_action\` themselves.
5. If a tool is not listed above (plugins, session tools, stubs), treat it as state-mutating and confirm before calling.

Phrase destructive confirmations concretely — "I want to run \`exec\` with command \`rm -rf ./build\` — proceed?" — so the user can judge intent at a glance.`;

export interface SafetySettings {
  /**
   * Global switch. When false (default), the Tools node renders
   * `ask_user` and `confirm_action` as checked-and-locked — the user
   * cannot uncheck them. When true ("Dangerous Fully Auto"), the lock is
   * lifted and the user takes responsibility for what follows.
   */
  allowDisableHitl: boolean;
  /** Markdown block appended to every agent system prompt that has a HITL tool. */
  confirmationPolicy: string;
}

export const DEFAULT_SAFETY_SETTINGS: SafetySettings = {
  allowDisableHitl: false,
  confirmationPolicy: DEFAULT_CONFIRMATION_POLICY,
};

/**
 * Previously shipped default policy texts. On load, a persisted setting
 * whose confirmationPolicy matches one of these strings is treated as
 * "never customized" and is upgraded to the current DEFAULT_CONFIRMATION_POLICY.
 * Users who deliberately edited their policy keep their customization.
 *
 * Add the previous DEFAULT_CONFIRMATION_POLICY string here every time it
 * is changed — never remove entries, so migrations keep working for
 * anyone coming from an older version.
 */
export const LEGACY_CONFIRMATION_POLICIES: string[] = [
  `## Confirmation policy

Before you perform any DESTRUCTIVE, IRREVERSIBLE, or STATE-MUTATING action you MUST call \`confirm_action\` with a short yes/no question summarizing what you are about to do, and wait for the answer.

This includes — but is not limited to:
- deleting or overwriting files (write_file on an existing path, rm, apply_patch that removes lines)
- shell commands that modify the system (exec/bash with rm, mv, git reset, migrations, installs)
- network mutations (POST, PUT, PATCH, DELETE)
- sending messages or emails on the user's behalf

RULES:
1. The confirmation call MUST be the ONLY tool call in that turn. Do not emit any other tool call alongside \`confirm_action\` — wait for the answer, then act on it in your next turn.
2. If the answer is "no" or the call is cancelled/timed out, you MUST abandon the action. Report what you would have done and stop.
3. If you need freeform input from the user (not yes/no), call \`ask_user\` instead.
4. Read-only operations (ls, cat, git status, web_search, calculator) do NOT require confirmation.`,
  // Blanket "confirm everything" policy (pre-classification). Users on this
  // default are migrated to the classification-aware version below.
  `## Confirmation policy

Before you call ANY tool OTHER THAN \`confirm_action\` or \`ask_user\`, you MUST first call \`confirm_action\` with a short yes/no question summarizing what you are about to do, and wait for the answer. This applies to every tool — including read-only ones (\`web_search\`, \`read_file\`, \`list_directory\`, \`calculator\`, etc.) AND state-mutating ones (\`write_file\`, \`edit_file\`, \`apply_patch\`, \`exec\`, \`bash\`, \`image_generate\`, \`send_message\`, network requests).

RULES:
1. The confirmation call MUST be the ONLY tool call in that turn. Do NOT emit any other tool call alongside \`confirm_action\` — wait for the answer, then act on it in your next turn.
2. If the answer is "no" or the call is cancelled/timed out, you MUST abandon the action. Report what you would have done and stop.
3. If you need freeform input from the user (not yes/no), call \`ask_user\` instead — this also satisfies the gate for the subsequent action you described.
4. Exception: you do NOT need confirmation for calling \`ask_user\` or \`confirm_action\` themselves.

Phrase the confirmation concretely — "I want to run \`exec\` with command \`rm -rf ./build\` — proceed?" — so the user can judge intent at a glance.`,
];

export interface PersistedSettings {
  apiKeys: Record<string, string>;
  agentDefaults: Record<string, unknown>;
  storageDefaults: Record<string, unknown>;
  safety?: SafetySettings;
  [key: string]: unknown;
}

const EMPTY_SETTINGS: PersistedSettings = {
  apiKeys: {},
  agentDefaults: {},
  storageDefaults: {},
  safety: { ...DEFAULT_SAFETY_SETTINGS },
};

export class SettingsFileStore {
  private readonly filePath: string;

  constructor(dir?: string) {
    this.filePath = path.join(dir ?? DEFAULT_DIR, SETTINGS_FILE);
  }

  async load(): Promise<PersistedSettings> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
      // Policy migration: if the persisted text matches any previously
      // shipped default, upgrade it to the current default. This guarantees
      // every user on an older default gets the new wording without losing
      // a hand-customized policy.
      const persistedPolicy = parsed.safety?.confirmationPolicy;
      const migratedPolicy =
        persistedPolicy === undefined
          || LEGACY_CONFIRMATION_POLICIES.includes(persistedPolicy.trim())
          ? DEFAULT_SAFETY_SETTINGS.confirmationPolicy
          : persistedPolicy;
      const safety: SafetySettings = {
        allowDisableHitl: parsed.safety?.allowDisableHitl ?? DEFAULT_SAFETY_SETTINGS.allowDisableHitl,
        confirmationPolicy: migratedPolicy,
      };
      return {
        ...parsed,
        apiKeys: parsed.apiKeys ?? {},
        agentDefaults: parsed.agentDefaults ?? {},
        storageDefaults: parsed.storageDefaults ?? {},
        safety,
      };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ...EMPTY_SETTINGS, safety: { ...DEFAULT_SAFETY_SETTINGS } };
      }
      throw err;
    }
  }

  async save(settings: PersistedSettings): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(settings, null, 2), 'utf-8');
  }

  getFilePath(): string {
    return this.filePath;
  }
}
