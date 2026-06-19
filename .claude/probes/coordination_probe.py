#!/usr/bin/env python3
"""
coordination_probe.py — team-wide PASSIVE coordination collector (agent boundary).

Why this exists: the A-layer artifact scan (baseline_collect_a.py) proved that for
this team the human coordination signal is NOT in git/Jira/PR artifacts (0 PR
reviews, ~0 cross-person Jira comments). It happens off-artifact. The only way to
capture it passively is at the Claude Code agent boundary — where the human steps
in, and where the agent turns to the human for missing context (an "escalation").

This is a Claude Code hook target. Register it on several hook events (see
settings.hooks.sample.json). On each event it reads the hook payload (JSON) on
stdin and appends ONE metadata-only line to a local JSONL. It never changes agent
behavior and never fails the turn (always exits 0).

PRIVACY / CONSENT (Research Proposal §10):
  - By DEFAULT it records metadata only — timestamps, member id, tool *names*,
    prompt *length* (not text), and a boolean "did the agent ask the human".
  - It NEVER stores prompt/response text unless PROBE_CAPTURE_CONTENT=1 is set
    (opt-in, off by default). This keeps client/Indigenous data out by construction.
  - It instruments developers, and only with their consent. Do not enable team-wide
    before consent is obtained.

member id resolution (so telemetry attributes per person — §10 per-member identity):
  env WAREHOUSE_MEMBER_ID  ->  .claude/probes/member_id.txt  ->  git user.name  ->  "(unset)"

Usage:
  (as a hook)   python coordination_probe.py        # reads payload on stdin
  (to inspect)  python coordination_probe.py --summary
"""
import sys, os, json, re, datetime, pathlib, subprocess

BASE = pathlib.Path(__file__).resolve().parent
DATA = BASE / "data"
EVENTS = DATA / "coordination_events.jsonl"
KEY_RE = re.compile(r"\b([A-Z][A-Z0-9]+-\d+)\b")
ASK_RE = re.compile(r"(\?\s*$|\b(could you|can you|would you|which|do you want|should i|"
                    r"please confirm|i need|let me know|your call|prefer)\b)", re.I)
CAPTURE_CONTENT = os.environ.get("PROBE_CAPTURE_CONTENT") == "1"

def now():
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")

def clean(s):
    """Surrogate-safe (Windows hook payloads can carry lone surrogates)."""
    return s.encode("utf-8", "replace").decode("utf-8") if isinstance(s, str) else s

def member_id():
    v = os.environ.get("WAREHOUSE_MEMBER_ID")
    if v:
        return v.strip()
    f = BASE / "member_id.txt"
    if f.exists():
        t = f.read_text(encoding="utf-8", errors="replace").strip()
        if t:
            return t
    try:
        out = subprocess.run(["git", "config", "user.name"], capture_output=True,
                             text=True, encoding="utf-8", errors="replace", timeout=5).stdout.strip()
        if out:
            return out
    except Exception:
        pass
    return "(unset)"

def tool_category(name):
    n = (name or "").lower()
    if "jira" in n or "atlassian" in n:
        return "jira_write" if any(h in n for h in ("create", "edit", "transition", "comment", "update")) else "jira_read"
    if "confluence" in n:
        return "confluence"
    if name in ("Edit", "Write", "NotebookEdit"):
        return "edit"
    if name in ("Bash", "PowerShell"):
        return "shell"
    if name in ("Read", "Grep", "Glob"):
        return "search"
    if name and name.startswith("mcp__"):
        return "mcp_other"
    return "other"

def agent_asked(transcript_path):
    """Best-effort: did the agent's last message end by asking the human something?
    Reads only the tail of the transcript; returns True/False/None. Stores a boolean,
    never the text."""
    try:
        p = pathlib.Path(transcript_path)
        if not p.exists():
            return None
        lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
        for line in reversed(lines[-60:]):
            try:
                obj = json.loads(line)
            except Exception:
                continue
            role = obj.get("role") or (obj.get("message") or {}).get("role") or obj.get("type")
            if role not in ("assistant",):
                continue
            msg = obj.get("message", obj)
            content = msg.get("content")
            text = ""
            if isinstance(content, str):
                text = content
            elif isinstance(content, list):
                text = " ".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
            if text.strip():
                return bool(ASK_RE.search(text.strip()[-400:]))
        return None
    except Exception:
        return None

def main():
    raw = sys.stdin.read()
    try:
        d = json.loads(raw)
    except Exception:
        return
    ev = d.get("hook_event_name") or "unknown"
    rec = {
        "ts": now(),
        "member": clean(member_id()),
        "event": ev,
        "session": (d.get("session_id") or "")[:8],
        "cwd": pathlib.Path(d.get("cwd") or "").name,
        "perm": d.get("permission_mode"),
    }

    if ev == "PostToolUse":
        name = d.get("tool_name") or ""
        rec["tool"] = name
        rec["tool_cat"] = tool_category(name)
        # cheap join key: any ISSUE-123 mentioned in input or response
        blob = json.dumps(d.get("tool_input"), ensure_ascii=False) + " " + \
               (d.get("tool_response") if isinstance(d.get("tool_response"), str)
                else json.dumps(d.get("tool_response"), ensure_ascii=False))
        keys = sorted(set(KEY_RE.findall(blob)))
        if keys:
            rec["keys"] = keys

    elif ev == "UserPromptSubmit":
        prompt = d.get("prompt") or ""
        rec["prompt_chars"] = len(prompt)            # human-intervention size, NOT the text
        rec["prompt_words"] = len(prompt.split())
        rec["mentions_key"] = bool(KEY_RE.search(prompt))
        if CAPTURE_CONTENT:
            rec["prompt_text"] = clean(prompt)

    elif ev == "Stop":
        rec["agent_asked"] = agent_asked(d.get("transcript_path"))  # escalation proxy

    elif ev in ("SessionStart", "SessionEnd"):
        rec["source"] = d.get("source") or d.get("reason")

    try:
        DATA.mkdir(parents=True, exist_ok=True)
        with EVENTS.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception:
        pass

def summary():
    if not EVENTS.exists():
        print("no events yet at", EVENTS)
        return
    import collections
    by_member = collections.Counter()
    by_event = collections.Counter()
    by_cat = collections.Counter()
    prompts = collections.Counter()
    asks = collections.Counter()
    sessions = collections.defaultdict(set)
    for line in EVENTS.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            r = json.loads(line)
        except Exception:
            continue
        m = r.get("member", "?")
        by_member[m] += 1
        by_event[r.get("event")] += 1
        if r.get("event") == "PostToolUse":
            by_cat[r.get("tool_cat")] += 1
        if r.get("event") == "UserPromptSubmit":
            prompts[m] += 1
        if r.get("event") == "Stop" and r.get("agent_asked"):
            asks[m] += 1
        if r.get("session"):
            sessions[m].add(r["session"])
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    print("coordination_probe summary  ·", EVENTS)
    print("  events by member :", dict(by_member))
    print("  events by type   :", dict(by_event))
    print("  tool categories  :", dict(by_cat))
    print("  user prompts/member (human-intervention load):", dict(prompts))
    print("  agent-asked-human (escalation proxy)/member  :", dict(asks))
    print("  sessions/member  :", {m: len(s) for m, s in sessions.items()})

if __name__ == "__main__":
    try:
        if "--summary" in sys.argv:
            summary()
        else:
            main()
    except Exception:
        pass
    sys.exit(0)
