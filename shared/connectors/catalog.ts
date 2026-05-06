import type { McpTransport } from '../agent-config';

export interface ConnectorVariable {
  /** Stable key, e.g. 'tokenEnvVar'. Used as a key in the connector node's `config` map. */
  key: string;
  /** Label shown in the property editor. */
  label: string;
  /** Default value when the user has not set this variable. */
  default: string;
  /** Help text shown next to the input. */
  description: string;
}

export interface ConnectorDefinition {
  id: string;
  label: string;
  description: string;
  mcp: {
    transport: McpTransport;
    command?: string;
    args?: string[];
    url?: string;
  };
  variables: ConnectorVariable[];
  /** Tool name prefix passed through to the MCP runtime. */
  toolPrefix: string;
  /**
   * Map resolved variable values into the MCP server's env map. Reads
   * `process.env` to materialize the secret; the graph file never contains it.
   */
  buildEnv(values: Record<string, string>): Record<string, string>;
}

export const CONNECTOR_CATALOG: Record<string, ConnectorDefinition> = {
  github: {
    id: 'github',
    label: 'GitHub',
    description: 'Read repos, search code, manage issues and PRs.',
    mcp: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
    },
    variables: [
      {
        key: 'tokenEnvVar',
        label: 'Token environment variable',
        default: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        description: 'Name of the env var holding your GitHub personal access token.',
      },
    ],
    toolPrefix: 'github_',
    buildEnv(values) {
      const name = values.tokenEnvVar || 'GITHUB_PERSONAL_ACCESS_TOKEN';
      const token = process.env[name];
      return token ? { [name]: token } : {};
    },
  },
};
