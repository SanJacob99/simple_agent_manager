# browser — Playwright-backed browser

Use the browser when the task requires navigating a real website, interacting with forms, or reading content that only appears after JavaScript runs.

- Issue one action per call (`navigate`, `click`, `type`, `snapshot`, `screenshot`). Take a snapshot right after navigation and before interacting — selectors drift between page loads.
- Prefer semantic selectors (role, visible text, label) over brittle CSS paths or XPath.
- Cookies and login state persist in the browser profile across calls, so don't re-authenticate when you're already logged in.
- Reach for `web_fetch` instead when you only need static HTML or a JSON endpoint — the browser is heavier.
