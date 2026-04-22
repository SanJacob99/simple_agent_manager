# code_execution — Sandboxed Python

Use `code_execution` when a task benefits from actually running Python — numerics, data parsing, quick scripts, or verifying a calculation — rather than reasoning through it by hand.

- Each call is a fresh sandbox; nothing persists between calls, so include all setup (imports, constants, sample data) inside the code you submit.
- Print the result explicitly. Silent execution leaves nothing to quote back to the user.
- Prefer `calculator` for single arithmetic expressions and `exec` when the goal is to run scripts in the user's workspace.
