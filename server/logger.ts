import fs from 'fs';
import path from 'path';

const logsDir = path.join(process.cwd(), 'logs');
fs.mkdirSync(logsDir, { recursive: true });

const stream = fs.createWriteStream(path.join(logsDir, 'debug.log'), { flags: 'w' });

function formatLine(category: string, message: string): string {
  return `[${new Date().toISOString()}] [${category}] ${message}\n`;
}

export function log(category: string, message: string): void {
  stream.write(formatLine(category, message));
}

export function logError(category: string, message: string): void {
  stream.write(formatLine(category, message));
  console.error(`[${category}]`, message);
}

export function logConsoleAndFile(category: string, message: string): void {
  stream.write(formatLine(category, message));
  console.log(`[${category}]`, message);
}
