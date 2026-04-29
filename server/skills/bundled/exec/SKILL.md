# exec — Shell execution

Use `exec` for running tests, invoking build scripts, or inspecting the workspace with tools the dedicated fs helpers can't cover.

- Prefer `read_file`, `edit_file`, `write_file`, and `list_directory` over `cat`, `sed`, `ls`, or shell redirects. Reach for `exec` only when those can't do the job.
- The shell depends on the host OS — bash on macOS/Linux, Windows PowerShell 5.1 on Windows. The tool description shows which one you're driving; check it before assuming syntax.
- On Windows PowerShell 5.1: use PowerShell syntax (`Get-ChildItem`, `Test-Path`, `$env:NAME`). `&&` / `||` chain operators are NOT available — use `;` or `if ($?) { ... }` instead. Avoid `2>&1` on native exes (it wraps stderr lines as `ErrorRecord` and flips `$?` to false even on exit code 0).
- Commands run from the configured working directory. If you pass `workdir`, it must exist; when `sandboxWorkdir` is on, it must stay inside the workspace.
- Default timeout is short. Pass a larger `timeout` for long builds or test suites, but don't leave work running longer than it needs.
- Don't chain `&&`-heavy scripts just to shorten output. Run commands one at a time when a later step depends on an earlier result, so failures are easy to attribute.
