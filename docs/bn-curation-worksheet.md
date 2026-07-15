# BN curation — `org-bn-map.ts`

**Status:** first pass done 2026-07-15. **8 federally-incorporated orgs curated** (in the map),
sourced from Corporations Canada's federal registry (`ised-isde.canada.ca/cc`) and matched to each
org's **Active parent** entity. The rest are categorized below by *why* they're not (yet) in the map.

Curation is a **human/registry step** — the code can *validate* a BN but not *find* one (there's no
name→BN search; `verifyBN` only goes BN→entity). These were read from the live registry by hand.

## ✅ Curated (in `ORG_BN_MAP` — verify before the prod migration)

Each is the **Active parent** among that name's registry hits (corp # recorded for audit). All 8 pass
`validate-org-bn-map.ts` (Luhn format + key matches a real seeded org).

| Slug | Registry legal entity (Active) | Corp # | BN root |
|---|---|---|---|
| `cameco` | CAMECO CORPORATION | 332981-0 | `890561467` |
| `nutrien` | Nutrien Ltd. | 1026366-4 | `710477720` |
| `suncor-energy` | Suncor Energy Inc. | 1562504-1 | `104168083` |
| `cenovus-energy` | Cenovus Energy Inc. | 1756759-6 | `873215610` |
| `imperial-oil` | IMPERIAL OIL LIMITED | 029646-5 | `102465879` |
| `cn-canadian-national-railway` | Canadian National Railway Company | 010533-3 | `100768779` |
| `loblaw-companies` | LOBLAW COMPANIES LIMITED | 012676-4 | `103363693` |
| `enbridge` | Enbridge Inc. *(parent of 62 entities — see note)* | 227602-0 | `119653384` |

> **Enbridge** returned 62 registry entities; `Enbridge Inc.` is the publicly-traded parent that
> publishes the RAP, so it was included despite the spec's earlier "leave out" default. Re-confirm if
> the team wants a different Enbridge entity.

**Before running the migration:** spot-check each BN against the registry (transcribed by hand from a
screen), and once the ISED integration is live, run `REGISTRY_IMPL=ised npx tsx
scripts/validate-org-bn-map.ts` for an automated legal-name cross-check.

## ✋ Not in this registry — source separately (not guessed)

The Corporations Canada **federal** database explicitly **excludes** financial institutions and
provincial/foreign corporations, so these can't be curated from it:

- **Financial institutions → OSFI, not CBCA.** `rbc-royal-bank-of-canada`, `bmo-bank-of-montreal`,
  `scotiabank`, `td-bank-group`, `national-bank-of-canada`, `sun-life`, `manulife`. *(Confirmed: an
  "Royal Bank of Canada" search returns only a **discontinued** shell + a dissolved pension society —
  the operating Bank Act entity isn't in this DB.)* Source their BN from OSFI / the entity directly.
- **Special-Act Crown corp.** `canada-post` — Canada Post Corporation (Canada Post Corporation Act) is
  not in the CBCA database (search returns only dissolved subsidiaries). Source separately.
- **Provincial crown utilities → provincial registries.** `bc-hydro`, `hydro-qu-bec` (`slugifyOrg`
  strips the é in Hydro-Québec), `saskpower`, `ontario-power-generation`, `manitoba-hydro`,
  `nova-scotia-power`.
- **Provincial / foreign incorporation (verify before assuming).** `teck-resources` (BC),
  `agnico-eagle` (ON), `newmont` (US parent), `canfor` (BC), `federated-co-operatives` (Sask co-op).
  Search "Canada's Business Registries" (provincial) for these; not searched here.

## Demo orgs — no map entry needed

`northway-energy` (`c-northway`), `cedar-trust-bank` (`c-cedartrust`), `maple-telecom` (`c-mapletel`)
are fictional demo accounts. Their commitments already carry `orgId`, so the company edits them via
the `orgId === partyId` path — they **don't need** the BN crosswalk. (If you want the demo to also
exercise the *claim-by-BN* path, give each a Luhn-valid synthetic BN and add it to the demo account's
claim + the stub registry's canned set — a demo-setup step, not curation.)

## How to expand later

Add a row to `ORG_BN_MAP` as `"<slug>": "<bn9>",` (slug = `slugifyOrg(orgName)`), then
`npx tsx scripts/validate-org-bn-map.ts` (format + key). The map is additive — the migration
(`docs/superpowers/plans/2026-07-15-domain-reconciliation-crosswalk.md` §Task 7 Step 5) only touches
mapped orgs, so expanding it and re-running is safe and idempotent.

*Full seeded set = 103 orgs: `grep -oE 'orgName: "[^"]+"' src/lib/commitments/fixtures.ts | sort -u`.*
