# exec — Shell execution

Use `exec` for running tests, invoking build scripts, or inspecting the workspace with tools the dedicated fs helpers can't cover.

- Prefer `read_file`, `edit_file`, `write_file`, and `list_directory` over `cat`, `sed`, `ls`, or shell redirects. Reach for `exec` only when those can't do the job.
- Commands run from the configured working directory. If you pass `workdir`, it must exist; when `sandboxWorkdir` is on, it must stay inside the workspace.
- Default timeout is short. Pass a larger `timeout` for long builds or test suites, but don't leave work running longer than it needs.
- Don't chain `&&`-heavy scripts just to shorten output. Run commands one at a time when a later step depends on an earlier result, so failures are easy to attribute.
