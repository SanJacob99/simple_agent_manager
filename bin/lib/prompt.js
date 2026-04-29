/**
 * Minimal stdin prompt for destructive-confirmation flows.
 * One question, one answer, line-buffered. No raw mode.
 */

import readline from 'readline';

export function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}
