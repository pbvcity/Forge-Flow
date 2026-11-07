# Review discipline

The goal is to find what would cause real loss, not to prove the code perfect. One lead reviewer decides. The first round finds almost everything worth finding, so give it full context and do not rely on later rounds.

## Reading

Read the diff, then the code it touches: callers of changed functions, and the acceptance criteria. Start from known paths. Skip vendored, generated, and cache directories. Skip style.

## A finding

Each finding has a severity, a short family name, a `file:line` read from the source, and six items:

1. **Scenario**: who, on which real path, with what input.
2. **Reachable in real use**: reproduced, reachable by code path, constructed input only, or unreachable.
3. **Loss type**: data, money, credentials, production outage, wrong external content, a promise to users, or none.
4. **Blast radius**: one record, one feature, whole site, or irreversible.
5. **How to reproduce**: a command or test name, or `none`.
6. **Smallest fix**: the change and its rough size, with the branches, config, state, or checks it adds.

Then apply these rules:

- Run it when you can. A finding you reproduced outranks one you reasoned out, so say which it is.
- A BLOCKER or HIGH missing any of the six becomes MEDIUM, tagged `insufficient evidence`. Keep it.
- Constructed input only: severity caps at MEDIUM, or HIGH on the high tier.
- Internal tools and reports cap at MEDIUM unless the loss is credentials or data.
- No loss, or unreachable: not a finding. Count it as dropped.
- One entry per family. Merge variants and count them.
- Only BLOCKER and HIGH block. Fix the rest in passing or put them on the residual risk card.
- A finding in code this change did not touch does not block. If it is a real bug, handle it as a follow-up.

## Required sections

Every review has these, even when empty:

- **Findings**, ordered by severity.
- **Can be deleted**: checks, branches, config, and tests that could go without adding loss. This section often pays more than the findings.
- **Dropped**: how many you considered and did not report.

## Deciding

For each blocking finding, the lead picks one and records why:

- **Block**: real loss on a main path. Fix before continuing.
- **Fix now**: correct but not serious. Fix in this batch.
- **Defer**: has a real external dependency. Write it where the next person will read it.
- **Reject**: wrong, overstated, or overbuilt, with evidence.

Ask of each: what loss does this prevent, and what does it cost when it misfires? Judge the argument, not who made it. A rare case that needs a heavy guard goes on the known-accepted list.

## Second reviewer and panels

- The second family has no vote, and every one of its findings gets a response.
- A panel runs in parallel in the first round only. Members cannot see each other's results.
- A member who times out or is missing is noted and does not affect the others.
- Agreement is a strong signal. If results diverge widely, the spec is underspecified: fix it and rerun rather than averaging.
- With no second family, run one more clean process of the same family and write `no independent-family review` on the card.

## Rounds

Fix rounds review the fix diff only, with one reviewer, preferably the finder.

| Tier | Most rounds |
|---|---|
| micro | Self-check |
| routine | 1, then the lead checks the fix diff |
| contract | 2 |
| high | 3 |

Another round is justified only if the fix changed control flow, queries, permissions, or money paths, brought a new family, or grew past three times the proposed fix. If a fix only removes checks or edits docs, the lead reads the diff and signs. Document reviews have no run results to converge on: one round, then fix and move on.

## When to stop

Stop reviewing when any of these holds:

- This round has no BLOCKER or HIGH from a new family.
- All remaining findings fail the rules above.
- Real paths are confirmed unaffected and only constructed input triggers it, outside the high tier. Record it as known accepted.
- The round limit is reached. Decide. "One more round" is not an option.

When the same family appears a second time, stop patching it. Narrow the feature, switch to a real parser or library, or downgrade to a warning or known-accepted item.

## Residual risk card

Close every contract or high review with at most eight lines:

- Proven:
- Not proven:
- Residual risk:
- Who catches it (alert, flag, rollback):
- Next look:

Keep known-accepted items in `REVIEW.md`, and feed them to the next review so they are not raised again.

## Contract and high checklist

- Every claim in the report has evidence, clause by clause. Acceptance rerun in an ordinary shell.
- Read 3 to 5 core paths end to end. Implemented, wired, and exercised, not stubbed.
- Tests go through the production entry point and do not mock the subject.
- The evidence fits the kind of work, and failure paths that matter were exercised. Queries ran on a real database when the project has one. Do not ask for tests where they add nothing.
- Client input cannot set decisions the server should recompute: price, tier, approval.
- Rate-limit and idempotency keys hold in the real deployment topology.
- External response fields match official docs.
- Failure consequences fit the value: one bad item does not void the whole.
- For executor output, look for work that passes acceptance by a trick instead of doing the task, weakened or deleted assertions, fixtures edited to pass, out-of-scope changes, hardcoded paths and commits, gates true only in its environment, and unexplained deviation from the spec.
- Visual work was seen rendered, or the report says it was not.
- Docs changed with behavior. Follow-ups are written down.

`ff audit` output is a hint list, except weakened tests, which block.

## Reviewer prompt

```markdown
Find problems that would cause real loss. You are not proving the code perfect.
Known accepted, do not raise: <path>
Input: <diff or range>. Acceptance criteria: <path>. Read-only.
Follow <path to this file> for finding format, severity caps, and required sections.
Do not write up anything without a real scenario and a loss.
Last line: VERDICT: PASS or VERDICT: FAIL. FAIL if any BLOCKER or HIGH remains.
```
