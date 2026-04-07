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
            name: 'Custom Model Agent',
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

test.describe('Custom Model Discovery E2E', () => {
  test('can configure a custom model ID on an agent node', async ({ page }) => {
    // Inject graph with an agent node
    await page.addInitScript((graph) => {
      localStorage.setItem('agent-manager-graph', JSON.stringify(graph));
    }, buildGraph());

    await page.goto('/');

    // Click the Agent node to select it
    await page.locator('.react-flow__node-agent').click();

    // Wait for properties panel to appear
    await expect(page.locator('h2', { hasText: 'Properties' })).toBeVisible();

    // Change Model dropdown to "__custom__"
    await page.locator('select').nth(1).selectOption('__custom__');

    // Verify the custom model input appears
    const customModelInput = page.getByPlaceholder('xiaomi/mimo-v2-pro');
    await expect(customModelInput).toBeVisible();

    // Fill the input with a custom ID
    await customModelInput.fill('custom/my-model-123');

    // Check that the graph store updated (or just visually remains)
    await expect(customModelInput).toHaveValue('custom/my-model-123');
  });
});
