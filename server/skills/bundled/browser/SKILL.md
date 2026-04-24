# browser - Playwright-backed browser

Use the browser when the task requires navigating a real website, interacting with forms, or reading content that only appears after JavaScript runs.

- For research tasks, use the browser to search, open pages, compare visible claims, and cite the URLs you relied on.
- For action tasks such as reservations, shopping, coupons, forms, and appointment scheduling, act like a user-authorized operator: prepare choices, fill ordinary non-sensitive fields, and pause before commitments.
- Issue one action per call. A strong loop is `navigate` -> `observe` -> `click`/`type`/`select`/`check` -> `wait` -> `observe`.
- Prefer semantic selectors (role, visible text, label) over brittle CSS paths or XPath.
- Use `scroll` for content below the fold, `select` for dropdowns, `check` for checkboxes/radios, and `list_tabs`/`new_tab`/`switch_tab` when comparing pages.
- Cookies and login state persist in the browser profile across calls, so don't re-authenticate when you're already logged in.
- Reach for `web_fetch` instead when you only need static HTML or a JSON endpoint; the browser is heavier.
- Do not bypass CAPTCHA, bot protection, paywalls, or access controls. If one appears, ask the user to take over or pick another allowed source.
- Do not ask the user to paste passwords, one-time codes, payment cards, or other secrets into chat. Hand those steps to the user in the browser; if the browser is headless, explain that the agent needs visible-browser mode or another authorized source.
- Before clicking a final submit/confirm button that commits the user (reservation, purchase, payment, message, appointment, cancellation, account change), call `confirm_action` as the only tool in that turn and wait for a clear "yes".
- Publicly displayed coupon codes may be tried. Do not brute-force, guess, or automate large coupon-code attempts.
