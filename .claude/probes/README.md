# Coordination Probe (team passive collector)

Captures the team's coordination signal **at the Claude Code agent boundary** — the
one place it actually shows up. The A-layer artifact scan (`baseline_collect_a.py`)
proved this team's coordination is *not* in git/Jira/PR artifacts (0 PR reviews,
~0 cross-person Jira comments); it happens off-artifact. This probe is the passive
way to see it.

## What it records (metadata only, by default)

One JSONL line per hook event in `data/coordination_events.jsonl`:

| Event | Captured | Signal |
|---|---|---|
| `PostToolUse` | tool name + category, any `ISSUE-123` keys | agent activity / which systems touched |
| `UserPromptSubmit` | prompt **length** (not text), whether it cites a key | human-intervention load |
| `Stop` | `agent_asked` boolean (did the agent end by asking the human?) | **escalation proxy** |
| `SessionStart/End` | source/reason | normalization (events per session) |

**It never stores prompt or response text** unless you set `PROBE_CAPTURE_CONTENT=1`
(opt-in). This keeps client/Indigenous data out by construction and respects the
study's developer-only boundary (Research Proposal §10).

## Consent first

This instruments *people*. Do **not** enable it team-wide before getting teammate
consent + confirming the IRB/ethics requirement (Research Proposal §10). Until then,
keep it to your own machine via `settings.local.json`.

## Install (per member)

1. **Set your member id** once (not committed):
   ```sh
   echo "Tong Wu" > .claude/probes/member_id.txt      # or: set WAREHOUSE_MEMBER_ID=Tong Wu
   ```
2. **Enable the hooks**: merge the `hooks` block from `settings.hooks.sample.json`
   into `.claude/settings.local.json` (just you) or `.claude/settings.json` (team,
   after consent). Restart Claude Code so hooks load.
3. If `python` isn't on PATH, change the command to `python3` in the snippet.

## Inspect

```sh
python .claude/probes/coordination_probe.py --summary
```

## Notes / next steps (productization)

- Data is local + per-member now. To aggregate across the team, sync each
  `coordination_events.jsonl` to one shared store (the warehouse). Member id makes
  the merge attributable.
- Pair this (agent-boundary coordination) with `baseline_collect_a.py` (artifact
  backbone, run on a schedule) for the full baseline picture.
- `agent_asked` is a heuristic; treat it as a proxy and validate against the C-layer
  manual tally during the baseline window.
