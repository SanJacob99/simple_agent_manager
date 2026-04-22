# canva — HTML/CSS/JS preview server

Use `canva` to render HTML/CSS/JS artifacts — charts, diagrams, UI mockups, or small interactive demos — on a local preview server the user can open in a browser.

- Write a complete, self-contained HTML document. Inline CSS and JS unless the artifact is large enough to warrant separate files.
- The tool returns a URL. Share that URL with the user so they can view the preview; don't paste the HTML back in chat unless they ask for it.
- Keep a canva process running only while the user is iterating on it; close it when the artifact is finalized.
