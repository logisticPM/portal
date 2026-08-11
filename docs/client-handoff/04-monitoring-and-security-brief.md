# Platform update: monitoring and security

## 1. The extraction pipeline now monitors itself

The part of the platform that reads uploaded RAP PDFs and pulls out their commitments now watches its own health and alerts us the moment something goes wrong.

We added this after a real incident: a settings change once stopped the document-reading step from working, yet the system still reported success — so the failure was invisible and could have gone unnoticed for weeks. Now:

- The system checks itself every 15 minutes for any document that failed or got stuck.
- When a document-reading job **hard-crashes**, its failure record is kept for two weeks (in a dead-letter queue) so it can be inspected or retried; ordinary handled failures stay visible in the review queue. Nothing is silently lost.
- We are emailed automatically if anything looks wrong, so problems surface in minutes rather than when someone notices missing data.
- A simple dashboard shows at a glance whether extraction is running normally.

## 2. A protective filter at the platform's entrance

We added a security filter that screens every visitor before they reach the site and — once blocking is switched on — will turn away harmful traffic. **Today it runs in watch-only (count) mode: it logs what it *would* block but blocks nothing yet** (see the closing note). It is designed to guard against three things:

- **Floods** of automated traffic that could slow the site down or run up cost.
- **Common attacks** — for example, attempts to sneak harmful commands in through the site's input boxes.
- **Known-bad traffic** that matches recognized malicious tools and patterns.

Why it matters: the portal is a public website holding Indigenous reconciliation data. Any public site attracts a constant background of automated probes, so this protection is standard for a live platform — and for sensitive, community-linked data it also safeguards trust, not just uptime.

We introduced it carefully. For now it runs in a watch-only mode: it logs what it *would* block without blocking anything yet, so we can be sure it never gets in the way of legitimate users — your staff, and companies uploading their RAPs — before switching it on fully.

## Known limitations

Automated alerts currently reach only a single project-team address (a team member's Northeastern email). Before the platform is handed over, a shared Institute inbox should be subscribed in its place, so alerts keep reaching someone once the capstone team's accounts are deactivated.

## Where things stand

Both improvements are live on the main platform and the Canada-based version. Monitoring and alerts are active; the security filter is on in watch-only mode, with full blocking as the one remaining step once we confirm it will not affect real users.
