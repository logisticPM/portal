# BN curation — `org-bn-map.ts`

**Status:** done 2026-07-15. **37 of 103 seeded orgs curated** (in the map) — every org whose
Business Number is sourceable from a public registry with an unambiguous Active parent. Sourced from
Corporations Canada: the federal registry + CBCA-active bulk open dataset for the 24 federal corps,
and **Canada's Business Registries** (`ised-isde.canada.ca/cbr-rec`, the provincial federated search)
for 13 provincial corps. **All 37 pass `validate-org-bn-map.ts`** (Luhn + key matches a real seeded org).

## ✅ Curated — federal CBCA (24)

Active parent among each name's registry hits (corp # in the map file for audit).

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

## ✅ Curated — provincial (13, via Canada's Business Registries)

BN root from the province's registry entry for the Active parent (registry ID / province in the map file).

| Slug | Registry legal entity | Prov | BN root |
|---|---|---|---|
| `telus` | TELUS Corporation | BC | `877429621` |
| `canfor` | CANFOR CORPORATION | BC | `100783562` |
| `west-fraser` | WEST FRASER TIMBER CO. LTD. | BC | `105643464` |
| `fortisbc` | FORTISBC HOLDINGS INC. | BC | `105349740` |
| `agnico-eagle` | AGNICO EAGLE MINES LIMITED | ON | `889122453` |
| `hydro-one` | HYDRO ONE LIMITED | ON | `805129962` |
| `ellisdon` | ELLISDON CORPORATION | ON | `872894332` |
| `glencore-canada` | GLENCORE CANADA CORPORATION | ON | `897767646` |
| `sobeys` | SOBEYS INC. | NS | `104902135` |
| `nova-scotia-power` | NOVA SCOTIA POWER INCORPORATED | NS | `119314938` |
| `pembina-pipeline` | PEMBINA PIPELINE CORPORATION | AB | `870693231` |
| `pcl-construction` | PCL CONSTRUCTORS INC. | AB | `104116249` |
| `altalink` | ALTALINK MANAGEMENT LTD. | AB | `868544818` |

> **Judgment calls to re-confirm:** `enbridge` (public parent among 62); `westjet` / `intact-financial`
> (CBCA holding chosen); `fortisbc` (Holdings entity for the BC brand); `pcl-construction`/`altalink`
> (operating corp for an employee-owned / LP structure); `sobeys`/`nova-scotia-power` (NS BN root taken
> from the `…NS0001`/`…NS0005` program-account string).

**Before the prod migration:** spot-check the flagged rows, and once the ISED integration is live run
`REGISTRY_IMPL=ised npx tsx scripts/validate-org-bn-map.ts` for an automated legal-name cross-check.

## ✋ Not curated (63) — categorized, not guessed

- **Banks/insurers → OSFI** (excluded from every business registry): `rbc-royal-bank-of-canada`,
  `bmo-bank-of-montreal`, `cibc`, `scotiabank`, `td-bank-group`, `national-bank-of-canada`, `sun-life`,
  `manulife`, `canada-life`, `co-operators`, `intact`-operating-insurer, `atb-financial`,
  `meridian-credit-union`, `vancity`.
- **Federal Crown corps (own Act):** `canada-post`, `business-development-bank-of-canada`,
  `export-development-canada`, `canada-infrastructure-bank`, `canada-mortgage-and-housing-corporation`,
  `parks-canada`, `via-rail`, `cbc-radio-canada`. **Special Act:** `bell-canada`.
- **Provincial crowns / statutory (no BN published):** `bc-hydro`, `ontario-power-generation`,
  `saskpower`, `manitoba-hydro`, `hydro-qu-bec` (QC), `bclc`, `metrolinx`, `translink`. *(Checked: BC
  Hydro and OPG return only entities with a blank BN.)*
- **Québec-incorporated (registry shows the NEQ, not the CRA BN):** `atkinsr-alis` (AtkinsRéalis/SNC),
  `wsp` (WSP Global). Get the BN from the entity directly.
- **Registry noise / no clean active BN:** `atco` (parent buried among 149 subs; QC extra-prov reg
  surfaces first), `rogers-communications` (QC NEQ + a BN-less recent BC reg), `graham-construction`
  (only inactive entries), `federated-co-operatives` (SK co-op — only a cancelled BC reg).
- **Foreign parent / JV / LP:** `newmont` (US), `diavik-diamond-mine-rio-tinto`, `syncrude` (JV),
  `bruce-power` (ON LP), `ikea-canada` (LP), `iron-ore-company-of-canada` (NL — not in CBR).
- **LLPs (provincial partnerships):** `deloitte-canada`, `kpmg-canada`, `pwc-canada`.
- **Universities (9) & health authorities (5)** — provincial statutory bodies, no corporate BN.
- **Airport / port authorities:** `calgary-airport-authority`, `edmonton-international-airport`,
  `toronto-pearson-gtaa`, `port-of-vancouver-vancouver-fraser-port-authority`.

To curate any of these, source the BN from the right place (OSFI for banks/insurers; the entity's own
filings for Québec corps, crown corps, and statutory bodies), add the row, and re-run the validator.

## Demo orgs — no map entry needed

`northway-energy` (`c-northway`), `cedar-trust-bank` (`c-cedartrust`), `maple-telecom` (`c-mapletel`)
are fictional demo accounts. Their commitments already carry `orgId`, so the company edits them via the
`orgId === partyId` path — they don't need the BN crosswalk.

*Full seeded set = 103 orgs. Coverage: **37 curated** (24 federal + 13 provincial) + 3 demo + 63
not-sourceable-from-a-public-registry.*
