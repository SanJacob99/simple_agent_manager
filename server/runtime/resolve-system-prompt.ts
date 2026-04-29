import type { AgentConfig, ResolvedSystemPrompt, SystemPromptSection } from '../../shared/agent-config';
import { estimateTokens } from '../../shared/token-estimator';
import { substituteBundledSkillsRoot } from '../skills/bundled-skills-root';
import { groupToolsByClassification } from '../tools/tool-registry';
import { resolveToolNames } from '../../shared/resolve-tool-names';
import { DEFAULT_SAFETY_SETTINGS, type SafetySettings } from '../storage/settings-file-store';

/**
 * Rewrite the `os=` field in a runtime line / section content so it
 * reflects the BACKEND platform instead of whatever the frontend
 * `navigator.platform` reported. The frontend builds the runtime
 * section, but the agent runs server-side, so the agent should see the
 * server's OS for things like exec command syntax.
 */
function rewriteRuntimeOs(text: string, backendOs: string): string {
  // Field shape: `os=<value>` where value runs to the next whitespace
  // or `|` separator. Replace literally; if no match, return as-is.
  return text.replace(/\bos=[^\s|]+/g, `os=${backendOs}`);
}

/**
 * Substitute `{{READ_ONLY_TOOLS}}` / `{{STATE_MUTATING_TOOLS}}` /
 * `{{DESTRUCTIVE_TOOLS}}` placeholders in the confirmation policy with
 * the enabled tools in each class. Unclassified tools are folded into
 * the state-mutating list (the safe default).
 */
export function fillConfirmationPolicyPlaceholders(
  policy: string,
  toolNames: string[],
): string {
  const { readOnly, stateMutating, destructive, unclassified } =
    groupToolsByClassification(toolNames);
  const fmt = (names: string[]): string =>
    names.length === 0 ? '(none enabled)' : names.map((n) => `\`${n}\``).join(', ');
  return policy
    .replace('{{READ_ONLY_TOOLS}}', fmt(readOnly))
    .replace('{{STATE_MUTATING_TOOLS}}', fmt([...stateMutating, ...unclassified]))
    .replace('{{DESTRUCTIVE_TOOLS}}', fmt(destructive));
}

export interface ResolveOutboundSystemPromptInput {
  config: AgentConfig;
  /** Global safety settings (confirmation policy, allowDisableHitl). */
  safetySettings?: SafetySettings;
  /**
   * Runtime workspace path used for the "Workspace (runtime)" fallback
   * section. Pass the same value AgentRuntime uses at run time --
   * typically `config.workspacePath ?? process.cwd()`. When omitted,
   * the caller is previewing without a concrete workspace and no
   * fallback section is added.
   */
  workspaceCwd?: string;
}

/**
 * Produce the system prompt pi-ai will actually send, plus its
 * per-section breakdown. This is the single source of truth for
 * "what the LLM sees": AgentRuntime uses it at construction time,
 * and the REST endpoint uses it to answer `SystemPromptPreview`.
 *
 * Outputs:
 * - `sections`: client-built sections with bundled-skills-root
 *   substitution applied + any runtime-injected sections
 *   (workspace fallback, HITL confirmation policy).
 * - `assembled`: the exact string that gets passed to pi-ai.
 */
export function resolveOutboundSystemPrompt(
  input: ResolveOutboundSystemPromptInput,
): ResolvedSystemPrompt {
  const { config } = input;
  const safetySettings = input.safetySettings ?? DEFAULT_SAFETY_SETTINGS;

  // 1. Apply bundled-skills-root substitution to each section + to
  // the full assembled string. Substitution is idempotent; sections
  // without placeholders come through unchanged.
  // Also rewrite the runtime section's `os=` to the backend's actual
  // platform, since the frontend fills it from `navigator.platform`
  // (the browser host) but the agent executes on the server.
  const backendOs = process.platform;
  const substitutedAssembled = rewriteRuntimeOs(
    substituteBundledSkillsRoot(config.systemPrompt.assembled),
    backendOs,
  );
  const resolvedSections: SystemPromptSection[] = config.systemPrompt.sections.map((s) => {
    const skillsSubstituted = substituteBundledSkillsRoot(s.content);
    const osRewritten = s.key === 'runtime'
      ? rewriteRuntimeOs(skillsSubstituted, backendOs)
      : skillsSubstituted;
    if (osRewritten === s.content) return s;
    return {
      ...s,
      content: osRewritten,
      tokenEstimate: estimateTokens(osRewritten),
    };
  });

  let assembled = substitutedAssembled;

  // 2. Workspace fallback -- only when the client-built prompt didn't
  // already include a workspace section *and* the caller supplied a
  // real cwd.
  if (input.workspaceCwd && !/Working directory: /.test(assembled)) {
    const content = `## Workspace\n\nWorking directory: ${input.workspaceCwd}`;
    assembled += `\n\n${content}`;
    resolvedSections.push({
      key: 'workspace-runtime',
      label: 'Workspace (runtime)',
      content,
      tokenEstimate: estimateTokens(content),
    });
  }

  // 3. HITL confirmation policy -- appended when either HITL tool is
  // in the resolved tool list. Matches AgentRuntime's logic including
  // the auto-inject of ask_user/confirm_action when allowDisableHitl
  // is false.
  const baseToolNames = config.tools ? resolveToolNames(config.tools) : [];
  const toolNames = [...baseToolNames];
  if (!safetySettings.allowDisableHitl) {
    if (!toolNames.includes('ask_user')) toolNames.push('ask_user');
    if (!toolNames.includes('confirm_action')) toolNames.push('confirm_action');
  }
  const hasHitlTool = toolNames.includes('confirm_action') || toolNames.includes('ask_user');
  const policy = safetySettings.confirmationPolicy?.trim();
  if (hasHitlTool && policy) {
    const content = fillConfirmationPolicyPlaceholders(policy, toolNames);
    assembled += `\n\n${content}`;
    resolvedSections.push({
      key: 'confirmationPolicy',
      label: 'Confirmation Policy',
      content,
      tokenEstimate: estimateTokens(content),
    });
  }

  return {
    mode: config.systemPrompt.mode,
    sections: resolvedSections,
    assembled,
    userInstructions: config.systemPrompt.userInstructions,
  };
}
