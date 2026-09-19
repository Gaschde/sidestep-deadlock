# Optimizer Next Research Handoff

This directory preserves the research that led to the next optimizer architecture.

## Read order for an implementation agent

1. **`decisions.md`** — authoritative implementation direction.
2. **`gpt-council.md`** — broad mathematical/model critique and long-term architecture.
3. **`claude-council.md`** — repository-grounded, conservative engineering review.
4. **`gemini-meta-review.md`** — independent comparison/red-team of both reports.

## Important

The reports are evidence and hypotheses. They are intentionally preserved even where they disagree.

Do **not** implement a statement merely because one report says it. Verify against the current repository first.

Development should continue on the branch:

`feature/optimizer-next`

The base point before optimizer-next work is:

`b0001472fbbcc2c3becc42582043d82caa547e88`
