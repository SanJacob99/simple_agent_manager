import fsPromises from 'fs/promises';
import path from 'path';

function parseEnvValue(rawValue: string): string {
  const trimmed = rawValue.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const unquoted = trimmed.slice(1, -1);
    return trimmed.startsWith('"')
      ? unquoted.replace(/\\n/g, '\n').replace(/\\"/g, '"')
      : unquoted;
  }

  const commentIndex = trimmed.indexOf(' #');
  return commentIndex === -1 ? trimmed : trimmed.slice(0, commentIndex).trim();
}

export async function loadEnvFile(
  filePath = path.resolve(process.cwd(), '.env'),
): Promise<Record<string, string>> {
  let content: string;
  try {
    // Avoid synchronous event-loop blocking by using async file read
    content = await fsPromises.readFile(filePath, 'utf-8');
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }

  const loaded: Record<string, string> = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const normalized = trimmed.startsWith('export ')
      ? trimmed.slice('export '.length).trim()
      : trimmed;
    const separatorIndex = normalized.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = normalized.slice(0, separatorIndex).trim();
    const value = parseEnvValue(normalized.slice(separatorIndex + 1));
    if (!key) {
      continue;
    }

    loaded[key] = value;
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return loaded;
}
