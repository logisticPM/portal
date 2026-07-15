# BN curation worksheet — `org-bn-map.ts`

**Purpose:** fill in verified 9-digit CRA Business Numbers for the seeded orgs most likely to
claim, then transcribe them into `src/lib/commitments/org-bn-map.ts` and run the prod migration.
This is a **human step** — the code can *validate* a BN but cannot *find* one (there is no
name→BN search; `verifyBN` only goes BN→entity). Sourcing each number is a registry lookup.

## Workflow

1. For each org below, find its **legal entity** and **9-digit CRA Business Number root** in the
   registry (Corporations Canada / ISED search, or the entity's public registration). Write it in
   the BN column. Leave any org you can't pin to one unambiguous entity **blank** (it stays
   display-only — that's the confidence gate working).
2. Transcribe the filled rows into `ORG_BN_MAP` in `src/lib/commitments/org-bn-map.ts` as
   `"<slug>": "<bn9>",` and delete the `cameco` synthetic placeholder (or give Cameco its real BN).
3. Validate: `npx tsx scripts/validate-org-bn-map.ts` (format + key checks). Once the ISED
   integration is activated, `REGISTRY_IMPL=ised npx tsx scripts/validate-org-bn-map.ts` adds a
   live cross-check that each BN's registry `legalName` matches the seeded org (wrong-entity guard).
4. Run the migration (see the plan, `docs/superpowers/plans/2026-07-15-domain-reconciliation-crosswalk.md` §Task 7 Step 5).

## ⚠️ Read before filling

- **The key is the CRA Business Number** (9-digit root, Luhn-valid — the script enforces this),
  which is distinct from a Corporations Canada *corporation number*. Don't confuse them.
- **`verifyBN` (ISED) covers FEDERALLY-incorporated corps only.** Banks and most national
  companies are federal (validatable); **provincial crown corps** (BC Hydro, Hydro-Québec,
  SaskPower, OPG, Manitoba Hydro, Nova Scotia Power) are provincially incorporated — their BN must
  be sourced separately and won't validate through the federal path. They're listed apart below.
- **Confidence-gate:** include an org only when its legal entity is unambiguous. Multi-entity
  brands (e.g. **Enbridge** — many federal subsidiaries) stay **out** until resolved.
- The slug is `slugifyOrg(orgName)` — already computed for you; use it verbatim as the map key.

---

## Section A — Demo orgs (synthetic BNs, not curation)

These three are **fictional** demo companies with platform accounts. Give each a Luhn-valid
**synthetic** BN (e.g. the map's existing `123456782`, or `100000009`) so the demo end-to-end works
— and add the same BN to the demo company's claim + the stub registry's canned set so
`/my-rap/claim` succeeds for that account. These are NOT real-world curation.

| Slug | Demo org | Demo account | Synthetic BN (Luhn-valid) |
|---|---|---|---|
| `northway-energy` | Northway Energy | `c-northway` | `________` |
| `cedar-trust-bank` | Cedar Trust Bank | `c-cedartrust` | `________` |
| `maple-telecom` | Maple Telecom | `c-mapletel` | `________` |

---

## Section B — Real orgs to curate (federal, unambiguous, procurement-relevant first)

Verify each BN against the registry. Prioritized toward orgs with **procurement** commitments
(these light up the confirmation bridge later) and household-name federal corps most likely to claim.

| Slug | Seeded org name | CRA BN (9-digit) | Verified? |
|---|---|---|---|
| `cameco` | Cameco | `________` | ☐ |
| `nutrien` | Nutrien | `________` | ☐ |
| `teck-resources` | Teck Resources | `________` | ☐ |
| `agnico-eagle` | Agnico Eagle | `________` | ☐ |
| `newmont` | Newmont | `________` | ☐ |
| `cenovus-energy` | Cenovus Energy | `________` | ☐ |
| `suncor-energy` | Suncor Energy | `________` | ☐ |
| `imperial-oil` | Imperial Oil | `________` | ☐ |
| `rbc-royal-bank-of-canada` | RBC (Royal Bank of Canada) | `________` | ☐ |
| `bmo-bank-of-montreal` | BMO (Bank of Montreal) | `________` | ☐ |
| `scotiabank` | Scotiabank | `________` | ☐ |
| `td-bank-group` | TD Bank Group | `________` | ☐ |
| `national-bank-of-canada` | National Bank of Canada | `________` | ☐ |
| `sun-life` | Sun Life | `________` | ☐ |
| `manulife` | Manulife | `________` | ☐ |
| `cn-canadian-national-railway` | CN (Canadian National Railway) | `________` | ☐ |
| `canada-post` | Canada Post | `________` | ☐ |
| `loblaw-companies` | Loblaw Companies | `________` | ☐ |
| `canfor` | Canfor | `________` | ☐ |
| `federated-co-operatives` | Federated Co-operatives | `________` | ☐ |

> Confirm each slug against `src/lib/commitments/fixtures.ts` before transcribing — the script's
> KEY check will reject any key that doesn't match a seeded org (so a typo migrates 0 rows and
> fails validation rather than silently doing nothing).

### Provincial crown corps — source BN separately (won't validate via ISED federal)
`bc-hydro` · `hydro-qu-bec` (note: `slugifyOrg` strips the `é` in Hydro-Québec) · `saskpower` ·
`ontario-power-generation` · `manitoba-hydro` · `nova-scotia-power`. Procurement-heavy and worth curating, but their BN comes from the provincial
registry and the federal `verifyBN` cross-check will report them "not found" — verify by hand.

### Explicitly excluded (ambiguous — leave blank)
`enbridge` (multiple federal subsidiaries — no single unambiguous entity). Add only if the team
decides which legal entity the seeded commitments belong to.

---

*Full seeded set = 103 orgs (`grep -oE 'orgName: "[^"]+"' src/lib/commitments/fixtures.ts | sort -u`).
This worksheet covers the top-N to start; the map is additive, so expand it over time.*
