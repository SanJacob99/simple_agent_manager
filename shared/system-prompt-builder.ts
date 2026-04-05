import { estimateTokens } from './token-estimator';
import type { SystemPromptMode, SystemPromptSection, ResolvedSystemPrompt } from './agent-config';

export interface SystemPromptBuilderInput {
  mode: SystemPromptMode;
  userInstructions: string;
  safetyGuardrails: string;
  toolsSummary: string | null;
  skillsSummary: string | null;
  workspacePath: string | null;
  bootstrapFiles: { name: string; content: string }[] | null;
  bootstrapMaxChars: number;
  bootstrapTotalMaxChars: number;
  timezone: string | null;
  runtimeMeta: {
    host: string;
    os: string;
    model: string;
    thinkingLevel: string;
  };
}

function makeSection(key: string, label: string, content: string): SystemPromptSection {
  return { key, label, content, tokenEstimate: estimateTokens(content) };
}

function truncateFile(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + '\n[truncated]';
}

function buildWorkspaceContent(
  workspacePath: string,
  files: { name: string; content: string }[],
  maxPerFile: number,
  maxTotal: number,
): string {
  let result = `## Workspace\n\nWorking directory: ${workspacePath}`;
  if (files.length === 0) return result;

  result += '\n\n### Project Context\n';
  let totalChars = 0;

  for (const file of files) {
    const truncated = truncateFile(file.content, maxPerFile);
    if (totalChars + truncated.length > maxTotal) break;
    result += `\n#### ${file.name}\n${truncated}\n`;
    totalChars += truncated.length;
  }

  return result;
}

function buildAutoSections(input: SystemPromptBuilderInput): SystemPromptSection[] {
  const sections: SystemPromptSection[] = [];

  // 1. Safety
  if (input.safetyGuardrails) {
    sections.push(makeSection('safety', 'Safety Guardrails', input.safetyGuardrails));
  }

  // 2. Tooling
  if (input.toolsSummary) {
    sections.push(makeSection('tooling', 'Tooling', `## Tooling\n\n${input.toolsSummary}`));
  }

  // 3. Skills
  if (input.skillsSummary) {
    sections.push(makeSection('skills', 'Skills', `## Skills\n\n${input.skillsSummary}`));
  }

  // 4. Workspace + bootstrap files
  if (input.workspacePath) {
    const content = buildWorkspaceContent(
      input.workspacePath,
      input.bootstrapFiles ?? [],
      input.bootstrapMaxChars,
      input.bootstrapTotalMaxChars,
    );
    sections.push(makeSection('workspace', 'Workspace', content));
  }

  // 5. Time
  if (input.timezone) {
    sections.push(makeSection('time', 'Current Date & Time', `## Current Date & Time\n\nTimezone: ${input.timezone}`));
  }

  // 6. Runtime
  const { host, os, model, thinkingLevel } = input.runtimeMeta;
  sections.push(makeSection(
    'runtime',
    'Runtime',
    `## Runtime\n\n${host} | ${os} | ${model} | thinking: ${thinkingLevel}`,
  ));

  return sections;
}

export function buildSystemPrompt(input: SystemPromptBuilderInput): ResolvedSystemPrompt {
  if (input.mode === 'manual') {
    const section = makeSection('manual', 'Manual Prompt', input.userInstructions);
    return {
      mode: 'manual',
      sections: [section],
      assembled: input.userInstructions,
      userInstructions: input.userInstructions,
    };
  }

  const sections = buildAutoSections(input);

  // Append mode: add user instructions at the end
  if (input.mode === 'append' && input.userInstructions.trim()) {
    sections.push(makeSection(
      'userInstructions',
      'User Instructions',
      `## User Instructions\n\n${input.userInstructions}`,
    ));
  }

  const assembled = sections.map(s => s.content).join('\n\n');

  return {
    mode: input.mode,
    sections,
    assembled,
    userInstructions: input.userInstructions,
  };
}
