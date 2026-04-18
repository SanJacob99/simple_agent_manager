export function normalizeToolName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Return the set of raw tool names that collide with another after normalization.
 * Duplicates (by normalized form) are all included in the returned list so the
 * caller can surface every conflicting source.
 */
export function findToolNameConflicts(names: Iterable<string>): string[] {
  const seen = new Map<string, string[]>();
  for (const raw of names) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = normalizeToolName(trimmed);
    const bucket = seen.get(key);
    if (bucket) {
      bucket.push(trimmed);
    } else {
      seen.set(key, [trimmed]);
    }
  }

  const conflicts = new Set<string>();
  for (const bucket of seen.values()) {
    if (bucket.length > 1) {
      for (const name of bucket) conflicts.add(name);
    }
  }
  return Array.from(conflicts);
}
