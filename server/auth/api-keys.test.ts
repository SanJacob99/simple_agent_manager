import { describe, it, expect, beforeEach } from 'vitest';
import { ApiKeyStore } from './api-keys';

describe('ApiKeyStore', () => {
  let store: ApiKeyStore;

  beforeEach(() => {
    store = new ApiKeyStore();
  });

  it('returns undefined for unknown provider', () => {
    expect(store.get('openai')).toBeUndefined();
  });

  it('stores and retrieves a key', () => {
    store.setAll({ openai: 'sk-test-123' });
    expect(store.get('openai')).toBe('sk-test-123');
  });

  it('overwrites all keys on setAll', () => {
    store.setAll({ openai: 'sk-1', anthropic: 'sk-2' });
    store.setAll({ openai: 'sk-3' });
    expect(store.get('openai')).toBe('sk-3');
    expect(store.get('anthropic')).toBeUndefined();
  });

  it('has() returns true only for set keys', () => {
    store.setAll({ openai: 'sk-1' });
    expect(store.has('openai')).toBe(true);
    expect(store.has('anthropic')).toBe(false);
  });
});
