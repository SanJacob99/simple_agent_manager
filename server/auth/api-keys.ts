/**
 * In-memory API key storage.
 * Single-user, not persisted to disk. Keys are re-entered on server restart.
 */
export class ApiKeyStore {
  private keys: Record<string, string> = {};

  /** Replace all stored keys. */
  setAll(keys: Record<string, string>): void {
    this.keys = { ...keys };
  }

  /** Get a key for a provider. Returns undefined if not set. */
  get(provider: string): string | undefined {
    return this.keys[provider];
  }

  /** Check whether a key exists for a provider. */
  has(provider: string): boolean {
    return provider in this.keys;
  }
}
