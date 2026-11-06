# Pack: Windows

Read when running on or shipping to Windows. Most of these pass in CI on Linux and fail only here.

## Text

- Set UTF-8 explicitly when reading or writing files and process output. Windows PowerShell 5.1 defaults to UTF-16 or ANSI. Decode output as a whole stream, not chunk by chunk, or multi-byte text breaks at the seams.
- U+FFFD in a repository document means the write damaged it: stop and reread the source. In tool output it is only a warning.
- A fresh checkout may be CRLF. Tests that assert LF fail unless `.gitattributes` pins line endings or the test normalizes.
- Non-ASCII paths: some tools report success without writing. Read back what you wrote.

## Paths

- File names are case-insensitive, and separators differ. Use `path.join`, and normalize before comparing.
- Pass absolute paths to child processes.
- `/dev/null` is `NUL` outside Git Bash. Git Bash rewrites arguments that look like POSIX paths, so set `MSYS_NO_PATHCONV=1` when that bites.
- Junctions and symlinks are followed by naive recursive deletion. List links first.
- Synced folders and antivirus hold files briefly. `unable to write new_index file` and similar lock errors clear on a retry.

## Processes

- CLIs installed by npm are often `.cmd` wrappers. Resolve them with `where` and spawn accordingly, rather than rejecting them.
- `bash` may resolve to the WSL launcher in System32. Use Git Bash by full path when you need it.
- Keep `SystemRoot`, `PATHEXT`, `TEMP`, and `USERPROFILE` in any restricted child environment. Losing them looks like a product failure.
- Kill whole process trees with `taskkill /t /f`. Confirm the tree is gone before starting another writer.
- A child holding stdio open keeps a parent from exiting. Use a file for output when launching long-lived services.
- Close stdin for headless executors, or they can wait forever.
- Hide windows for background work (`windowsHide: true`).

## Shells

- PowerShell has no `&&` before version 7, and quoting differs from bash. Say which shell a command is for.
- Set execution policy per process, not machine-wide.
- A blocked temp cleanup is not a task failure. Report it and move on.

## Before saying done

- [ ] Ran in an ordinary shell, not only the executor's.
- [ ] Tried a path with spaces and non-ASCII characters.
- [ ] Output with non-ASCII text survived intact.
- [ ] No orphan processes remain.
