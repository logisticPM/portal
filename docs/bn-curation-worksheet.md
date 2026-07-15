# BN curation — `org-bn-map.ts`

**Status:** done 2026-07-15. **24 of 103 seeded orgs curated** (in the map) — every
federally-incorporated (CBCA) org whose parent is unambiguous. Sourced from Corporations Canada:
the interactive federal registry (`ised-isde.canada.ca/cc`) for the first batch, then cross-checked
and extended against the **CBCA-active bulk open dataset** (`open.canada.ca`, 98 MB, matched by
corporate name). The other 79 orgs are categorized below by *why* they can't be curated from this
registry. **All 24 pass `validate-org-bn-map.ts`** (Luhn format + key matches a real seeded org).

## ✅ Curated (24 — in `ORG_BN_MAP`)

Each is the **Active parent** among that name's registry hits (corp # in the map file for audit).

| Slug | Registry legal entity | BN root |
|---|---|---|
| `cameco` | CAMECO CORPORATION | `890561467` |
| `nutrien` | Nutrien Ltd. | `710477720` |
| `suncor-energy` | Suncor Energy Inc. | `104168083` |
| `cenovus-energy` | Cenovus Energy Inc. | `873215610` |
| `imperial-oil` | IMPERIAL OIL LIMITED | `102465879` |
| `cn-canadian-national-railway` | Canadian National Railway Company | `100768779` |
| `loblaw-companies` | LOBLAW COMPANIES LIMITED | `103363693` |
| `air-canada` | AIR CANADA | `100092287` |
| `cpkc-canadian-pacific-kansas-city` | Canadian Pacific Kansas City Limited | `882884711` |
| `tc-energy` | TC Energy Corporation | `897657508` |
| `transalta` | TransAlta Corporation | `134234855` |
| `capital-power` | CAPITAL POWER CORPORATION | `808499024` |
| `trans-mountain-corporation` | TRANS MOUNTAIN CORPORATION | `752524686` |
| `vale-canada` | Vale Canada Limited | `102475084` |
| `teck-resources` | Teck Resources Limited | `893110981` |
| `maple-leaf-foods` | MAPLE LEAF FOODS INC. | `898324041` |
| `aecon` | AECON GROUP INC. | `100263540` |
| `stantec` | Stantec Inc. | `130521958` |
| `cae` | CAE INC. | `100717065` |
| `northwestel` | NORTHWESTEL INC. | `121336721` |
| `westjet` | WestJet Group Inc. | `791790470` |
| `intact-financial` | Intact Financial Corporation | `891059693` |
| `the-north-west-company` | The North West Company Inc. | `895556991` |
| `enbridge` | Enbridge Inc. *(parent of 62 entities)* | `119653384` |

> **Judgment calls flagged:** `enbridge` (62 entities → chose the public parent Enbridge Inc.);
> `westjet` (chose the CBCA holding **WestJet Group Inc.**); `intact-financial` (the CBCA holding
> **Intact Financial Corporation** — the operating insurer is under OSFI). Re-confirm if the team wants
> a different entity for any of these.

**Before the prod migration:** spot-check the flagged rows against the registry, and once the ISED
integration is live run `REGISTRY_IMPL=ised npx tsx scripts/validate-org-bn-map.ts` for an automated
legal-name cross-check.

## ✋ Not curated (79) — categorized, not guessed

None of these are in the CBCA federal registry, so a BN can't be sourced from it:

- **Banks/insurers → OSFI** (Bank/Insurance Act, not CBCA): `rbc-royal-bank-of-canada`,
  `bmo-bank-of-montreal`, `cibc`, `scotiabank`, `td-bank-group`, `national-bank-of-canada`, `sun-life`,
  `manulife`, `canada-life`. *(Confirmed empirically: an RBC search returns only a discontinued shell;
  Manulife/Sun Life return only subsidiaries, not the OSFI-regulated parent.)*
- **Federal Crown corps (own Act, not CBCA):** `canada-post`, `business-development-bank-of-canada`,
  `export-development-canada`, `canada-infrastructure-bank`, `canada-mortgage-and-housing-corporation`,
  `parks-canada` (agency), `via-rail`, `cbc-radio-canada` (Broadcasting Act).
- **Special Act corporation:** `bell-canada` (Bell Canada Act).
- **Provincial crown / utilities:** `bc-hydro`, `hydro-qu-bec`, `saskpower`, `ontario-power-generation`,
  `manitoba-hydro`, `nova-scotia-power`, `hydro-one`, `altalink`, `fortisbc`, `atco`, `atb-financial`,
  `bclc`.
- **Provincial corporations / partnerships:** `telus`, `pembina-pipeline`, `rogers-communications`
  (parent BC), `sobeys` (NS), `agnico-eagle` (ON), `canfor` (BC), `west-fraser` (BC), `ellisdon` (ON),
  `pcl-construction` (AB), `graham-construction` (AB), `atkinsr-alis` (SNC-Lavalin, QC), `wsp` (parent
  WSP Global QC; only the sub *WSP Canada Inc.* is CBCA), `ikea-canada` (LP), `bruce-power` (ON LP),
  `syncrude` (JV), `glencore-canada`, `iron-ore-company-of-canada`, `meridian-credit-union` (ON),
  `vancity` (BC), `co-operators` (co-op).
- **Foreign parent:** `newmont` (US), `diavik-diamond-mine-rio-tinto` (Rio Tinto JV).
- **LLPs (provincial partnerships):** `deloitte-canada`, `kpmg-canada`, `pwc-canada`.
- **Universities (provincial statutory bodies — no corp BN):** `mcgill-university`, `mcmaster-university`,
  `red-river-college-polytechnic`, `university-of-alberta`, `university-of-british-columbia`,
  `university-of-calgary`, `university-of-manitoba`, `university-of-toronto`, `western-university`.
- **Health authorities (provincial statutory):** `alberta-health-services`, `fraser-health`,
  `interior-health`, `saskatchewan-health-authority`, `vancouver-coastal-health`.
- **Airport / port / transit authorities:** `calgary-airport-authority`, `edmonton-international-airport`,
  `toronto-pearson-gtaa`, `port-of-vancouver-vancouver-fraser-port-authority`, `metrolinx`, `translink`.

To curate any of these, source the BN from the right registry (OSFI for banks/insurers; Canada's
Business Registries / the province for provincial corps; the entity's own filings for crown corps and
statutory bodies), add the row, and re-run `validate-org-bn-map.ts`.

## Demo orgs — no map entry needed

`northway-energy` (`c-northway`), `cedar-trust-bank` (`c-cedartrust`), `maple-telecom` (`c-mapletel`)
are fictional demo accounts. Their commitments already carry `orgId`, so the company edits them via
the `orgId === partyId` path — they don't need the BN crosswalk.

*Full seeded set = 103 orgs: `grep -oE 'orgName: "[^"]+"' src/lib/commitments/fixtures.ts | sort -u`.
Coverage: 24 curated + 3 demo + 76 categorized (not in the federal CBCA registry).*
