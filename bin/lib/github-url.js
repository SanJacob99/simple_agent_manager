/**
 * Parse a GitHub URL and derive the codeload tarball URL.
 *
 * Accepted forms:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/
 *   https://github.com/owner/repo.git
 *   https://github.com/owner/repo/tree/<ref>
 *
 * Anything else throws with a caller-friendly message.
 *
 * Default ref is `HEAD`, which `codeload.github.com/<o>/<r>/tar.gz/HEAD`
 * resolves to the repo's default branch.
 */

export function parseGithubUrl(input) {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) throw new Error('Empty URL.');

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Not a valid URL: ${input}`);
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Only http(s) URLs are supported (got ${parsed.protocol}).`);
  }
  if (parsed.host !== 'github.com') {
    throw new Error(`Only github.com URLs are supported (got ${parsed.host}).`);
  }

  const parts = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/');
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error(
      `Expected /owner/repo in URL path (got "${parsed.pathname}"). ` +
        `Example: https://github.com/owner/repo or https://github.com/owner/repo/tree/main.`,
    );
  }

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/, '');
  let ref = 'HEAD';

  if (parts.length > 2) {
    if (parts[2] !== 'tree' || parts.length < 4) {
      throw new Error(
        `Unsupported URL form. Use /owner/repo or /owner/repo/tree/<ref> (got "${parsed.pathname}").`,
      );
    }
    ref = parts.slice(3).join('/');
  }

  return {
    owner,
    repo,
    ref,
    sourceUrl: `https://github.com/${owner}/${repo}`,
    codeloadUrl: `https://codeload.github.com/${owner}/${repo}/tar.gz/${ref}`,
  };
}
