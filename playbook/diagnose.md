# Diagnosis discipline

A task failed once in an unattended run. The diagnostician reads the evidence and says why, so the next attempt fixes the cause instead of repeating the miss. It is read-only: it does not modify files or run write commands, and it does not try the fix itself.

## Input

- The task card: title, details, and acceptance commands.
- The acceptance output, review findings, or other evidence from the failed attempt.
- A file inventory of that attempt's work and the path to its full patch. Read the hunks you need from the patch and the code from the working tree.
- For a consult, the first diagnosis as well. Judge it; do not assume it is right.

## Reading

Read the evidence first, then the diff, then the code it touches. If your tools allow running commands, run read-only ones when they help: a failing command's output, a grep for the symbol it names, the test it runs. If you can only read and search files, work from the evidence and the code. Do not guess at a cause the evidence does not show.

## Categories

Pick exactly one:

- **SLIP**: the model missed something, and the fix is clear. A wrong path, a missing case, an assertion that does not match the spec, a test it never ran.
- **ENVIRONMENT**: the fix needs a person or the environment. A missing dependency, network, port, credential, permission, or tool.
- **SPEC**: the task's premise or its acceptance is wrong. The command cannot pass as written, the task contradicts the plan, or the outcome needs a decision nobody made.
- **UNCLEAR**: the cause cannot be found from the evidence.

A failure that mixes categories takes the one whose fix comes first. When a slip hides behind an environment problem, say ENVIRONMENT.

## Output

Write, in this order:

1. **Cause**: one or two sentences, with `file:line` where there is one. For ENVIRONMENT, name what is missing. For SPEC, name the premise or acceptance line that is wrong.
2. **Fix**: the concrete change for the next attempt, small enough to do in one pass. For UNCLEAR, what to look at first.
3. **Evidence**: what in the output or diff shows this.

Last line, alone: `DIAGNOSIS: SLIP`, `DIAGNOSIS: ENVIRONMENT`, `DIAGNOSIS: SPEC`, or `DIAGNOSIS: UNCLEAR`. The tool reads the last such line; anything missing counts as UNCLEAR.

## Diagnostician prompt

```markdown
Read-only diagnosis. Do not modify files or run write commands.
A task failed once. Find the cause and give the next attempt a concrete fix.
Follow <path to this file> for categories and output.
Last line: DIAGNOSIS: SLIP, DIAGNOSIS: ENVIRONMENT, DIAGNOSIS: SPEC, or DIAGNOSIS: UNCLEAR.
```
