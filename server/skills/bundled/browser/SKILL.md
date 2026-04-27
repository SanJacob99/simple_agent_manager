# browser - Playwright-backed browser

Use the browser when the task requires navigating a real website, interacting with forms, or reading content that only appears after JavaScript runs.

- For research tasks, use the browser to search, open pages, compare visible claims, and cite the URLs you relied on.
- For action tasks such as reservations, shopping, coupons, forms, and appointment scheduling, act like a user-authorized operator: prepare choices, fill ordinary non-sensitive fields, and pause before commitments.
- Issue one action per call. A strong loop is `navigate` -> `observe` -> `click`/`type`/`select`/`check` -> `wait` -> `observe`.
- Prefer semantic selectors (role, visible text, label) over brittle CSS paths or XPath.
- Use `scroll` for content below the fold, `select` for dropdowns, `check` for checkboxes/radios, and `list_tabs`/`new_tab`/`switch_tab` when comparing pages.
- Cookies and login state persist in the browser profile across calls, so don't re-authenticate when you're already logged in.
- Reach for `web_fetch` instead when you only need static HTML or a JSON endpoint; the browser is heavier.
- Do not bypass CAPTCHA, bot protection, paywalls, or access controls. When one appears, treat it as a signal to switch sources, not to stop. The retry playbook below applies.
- Do not ask the user to paste passwords, one-time codes, payment cards, or other secrets into chat. Hand those steps to the user in the browser; if the browser is headless, explain that the agent needs visible-browser mode or another authorized source.
- The browser tool gates itself. Do **not** call `confirm_action` before browser actions — the tool fires a specific approval prompt at the moment a committing action runs (click/type/select/check/key/evaluate/new_tab/switch_tab/close_tab/close/handover), naming the exact selector and URL. Read-only actions (navigate/search/observe/text/snapshot/screenshot/scroll/wait/status/list_tabs/back/forward/reload) proceed without any prompt.
- If the user declines a gated action, the tool returns a "not approved" result. Do **not** retry the same call — ask what to do next or try a different approach.
- Publicly displayed coupon codes may be tried. Do not brute-force, guess, or automate large coupon-code attempts.

## When a page is blocked (bot protection, CAPTCHA, empty SERP)

Bot protection is the default state of the public web for headless traffic. Do not solve the challenge and do not stop on the first block. Run the playbook:

1. Prefer `browser(action="search", query="...")`. It navigates DuckDuckGo → Bing → Brave → Startpage → Ecosia automatically and returns the first SERP that loads without a block. Try this before any manual search-engine URL. Skip Google — its SERP is almost always blocked.
2. If `search` exhausts every engine, navigate to a topical aggregator or the brand site directly. Examples by intent:
   - **Deals/coupons** — Groupon, RetailMeNot, Slickdeals, Honey, the brand's own `/deals` or `/coupons` page.
   - **Restaurants/reservations** — Yelp, OpenTable, Resy, the restaurant's own site.
   - **Travel/getaways** — TripAdvisor, Wikipedia (for the destination), Reddit city subreddits, the city's official tourism site.
   - **Products/specs** — Wikipedia, the manufacturer's site, the retailer's product page directly.
   - **Discussions/reviews** — Reddit, Hacker News.
3. If two or more alternates are also blocked or empty, switch to the `web_search` or `web_fetch` tool — those go through provider APIs and don't hit the same bot defenses.
4. If the task genuinely needs **this specific blocked site** (a logged-in flow, a CAPTCHA-gated checkout, a 2FA step), call `browser(action="handover", reason="captcha"|"login"|"2fa"|"payment"|"other", instructions="...")`. The visible Chrome window stays open; the user does the human step in-place and clicks Yes to resume. You then get a fresh observe of the post-handover page. Requires a visible browser — if headless, that's an error.
5. If blocks persist even after `handover` (e.g. TLS/JA3 fingerprinting that doesn't care about page-level actions), the user can configure the tool to attach to their own Chrome via the `cdpEndpoint` setting. You don't flip that setting; only tell the user about it in an `ask_user` call if the block pattern looks fingerprint-level rather than challenge-level (e.g. 403 with no interactive challenge, Akamai/PerimeterX error pages).
6. Only call `ask_user` once the playbook is exhausted. When you do, report which sources you tried and what each returned so the user can make an informed call.

Do not re-try the same blocked URL or the same search engine in a loop — that's the signal the playbook failed, move to the next step.
