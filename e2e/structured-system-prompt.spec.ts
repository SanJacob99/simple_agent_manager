import { test, expect } from '@playwright/test';

function buildGraph() {
  return {
    id: 'default',
    version: 2,
    updatedAt: Date.now(),
    graph: {
      nodes: [
        {
          id: 'agent-1',
          type: 'agent',
          position: { x: 500, y: 250 },
          data: {
            type: 'agent',
            name: 'System Prompt Agent',
            nameConfirmed: true,
            systemPrompt: 'You are a concise assistant.',
            systemPromptMode: 'auto',
            provider: 'openrouter',
            modelId: 'qwen/qwen3.6-plus:free',
            thinkingLevel: 'off',
            description: '',
            tags: [],
            modelCapabilities: {}
          },
        }
      ],
      edges: [],
    },
  };
}

test.describe('Structured System Prompt E2E', () => {
  test('can switch to append mode and view full prompt preview', async ({ page }) => {
    // Inject graph with an agent node
    await page.addInitScript((graph) => {
      localStorage.setItem('agent-manager-graph', JSON.stringify(graph));
    }, buildGraph());

    await page.goto('/');

    // Click the Agent node to select it
    await page.locator('.react-flow__node-agent').click();

    // Wait for properties panel to appear
    await expect(page.locator('h2', { hasText: 'Properties' })).toBeVisible();

    // Change System Prompt Mode to "append"
    await page.getByLabel('System Prompt Mode').selectOption('append');

    // Verify "Your Instructions" textarea appears
    await expect(page.getByLabel('Your Instructions')).toBeVisible();

    // Click "View full prompt" button
    await page.getByRole('button', { name: 'View full prompt' }).click();

    // Assert the SystemPromptPreview panel appears
    await expect(page.locator('h3', { hasText: 'System Prompt Preview' })).toBeVisible();

    // Verify sections are visible (e.g., Safety, Runtime)
    // The Preview Panel renders the label inside a span with text-xs, not h4.
    await expect(page.locator('span', { hasText: 'Safety Guardrails' })).toBeVisible();
    await expect(page.locator('span', { hasText: 'Runtime' }).first()).toBeVisible();

    // Close the preview modal
    await page.locator('button', { hasText: 'Close' }).click();
  });
});
