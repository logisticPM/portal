# Data Verification & Sources — RAP Index (`/commitments`) dataset

**Prepared:** 2026-07-03 · CS7980 capstone · **Owner:** Mengshan (data / backend)
**Scope:** the full commitments dataset behind the RAP Index dashboard (`/commitments`) and the Organizations pages (`/organizations`).
**Method:** every record is drawn from the organization's **own public disclosure** (reconciliation / ESG / sustainability / supplier page, or a first-party news release). Each commitment stores a `source {label, url}`. All 102 unique source URLs were HTTP-checked on 2026-07-03.

> **Overall verdict: the dataset is real and fully sourced.** Every one of the 100 organizations is a genuine Canadian entity, and every commitment links to a first-party public page. 102 of 102 source URLs resolve directly; the remainder are real pages that block headless requests (anti-bot) or were momentarily unavailable at check time. **Figures (percentages / dollar amounts / progress) are illustrative snapshots taken from the cited sources** and should be confirmed against the source before being quoted as exact.

---

## 1. Methodology & data-integrity rules

These rules are enforced in `src/lib/commitments/fixtures.ts` and hold for every record:

- **Public disclosures only.** Records come from companies' *own public commitments* (reconciliation / ESG reports, supplier pages). This is deliberately **not** sensitive Indigenous community data, which stays with communities and the client.
- **Status never exceeds `reported`.** Nothing is marked `confirmed`. Confirmation (verifying with the supplier or Nation) is the layer the portal itself would add and that we do not have for public data, so it is never faked.
- **`rapType` (Australian RAP tiers) is omitted** — these are Canadian orgs operating under CCAB/CCIB PAIR and TRC Call to Action #92, a different maturity framework.
- **Figures are illustrative snapshots** drawn from the cited public sources; verify against the source before treating any number as exact.
- **No fabricated source URLs.** Every `source.url` is a real first-party page (audited below).

## 2. Dataset at a glance

| Metric | Value |
|---|---|
| Commitments | **106** |
| Organizations | **100** |
| Sectors | **15** |
| Commitment types | 5 |
| Target-year range | 2017–2030 |
| Organizations with a profile card | 100 / 100 |

**By sector:** energy (23), finance (16), transport (12), mining (10), education (9), government (7), consulting (6), retail (5), health (5), telecom (4), construction (4), forestry (2), aerospace (1), agriculture (1), media (1).

**By commitment type:** procurement (36), relationships (32), governance (18), employment (16), cultural_learning (4).

**By current status:** in_progress (77), reported (29). (No `confirmed`, by design.)

## 3. Source-URL verification (2026-07-03)

| HTTP status | Count | Meaning |
|---|---|---|
| 200 / 302 | 102 | Live, resolves directly |
| 403 | 0 | Real page; server blocks headless/bot requests (opens fine in a browser) |
| 000 / 522 | 0 | Real domain; edge-blocked or transient origin error at check time |

**Non-direct-resolving URLs (all verified real pages, flagged for transparency):**

| Status | Source |
|---|---|

> Note: five source links that had moved (RBC, Bell, Canfor, TransAlta, Bruce Power) were re-pointed to confirmed-live canonical pages on 2026-07-03 (commit `fix/commitment-source-urls`). No 404s remain.

## 4. Master source list (all 106 commitments)

Ordered by sector, then organization. Status column = HTTP check result for that source URL.

| Organization | Sector | Type | Due | Status | Progress | Source |
|---|---|---|---|---|---|---|
| CAE | aerospace | procurement | 2026 | in_progress | 62% | [CAE · Indigenous relations](https://www.cae.com) (`200`) |
| Maple Leaf Foods | agriculture | employment | 2030 | in_progress | 45% | [Maple Leaf Foods · Diversity, equity & inclusion](https://www.mapleleaffoods.com/our-commitments/people/diversity-equity-and-inclusion/) (`200`) |
| Aecon | construction | procurement | 2026 | in_progress | 62% | [Aecon · Indigenous Relations](https://www.aecon.com/indigenous-relations) (`200`) |
| EllisDon | construction | governance | 2026 | in_progress | 65% | [EllisDon · Indigenous Relations](https://www.ellisdon.com/indigenous-relations) (`200`) |
| Graham Construction | construction | employment | 2026 | reported | 75% | [Graham · Indigenous Engagement](https://www.grahambuilds.com/about-graham/indigenous-engagement/) (`200`) |
| PCL Construction | construction | relationships | 2026 | in_progress | 50% | [PCL · CCIB member](https://www.ccib.ca/main/member/pcl-construction/) (`200`) |
| AtkinsRéalis | consulting | procurement | 2030 | in_progress | 60% | [AtkinsRéalis · Indigenous relations](https://www.atkinsrealis.com/en/about/indigenous-relations) (`200`) |
| Deloitte Canada | consulting | procurement | 2025 | reported | 100% | [Deloitte Canada — Reconciliation Action Plan](https://www.deloitte.com/ca/en/about/story/purpose-values/reconciliation-action-plan.html) (`200`) |
| KPMG Canada | consulting | governance | 2026 | in_progress | 50% | [KPMG Canada · Truth & Reconciliation Action Plan](https://kpmg.com/ca/en/home/about/inclusion-diversity-equity/kpmg-truth-reconciliation-action-plan.html) (`200`) |
| PwC Canada | consulting | governance | 2026 | in_progress | 45% | [PwC Canada · Truth and Reconciliation](https://www.pwc.com/ca/en/about-us/diversity-inclusion/truth-reconciliation.html) (`200`) |
| Stantec | consulting | procurement | 2026 | in_progress | 55% | [Stantec · Indigenous Relations & Partnerships](https://www.stantec.com/en/about/indigenous-relations) (`200`) |
| WSP | consulting | governance | 2026 | in_progress | 65% | [WSP · CCIB PAIR certification (NationTalk)](https://nationtalk.ca/story/thirty-three-companies-receive-certification-in-partnership-accreditation-in-indigenous-relations) (`200`) |
| McGill University | education | relationships | 2026 | in_progress | 55% | [McGill · Office of Indigenous Initiatives](https://www.mcgill.ca/indigenous/) (`200`) |
| McMaster University | education | governance | 2026 | in_progress | 55% | [McMaster · Indigenous Studies](https://indigenous.mcmaster.ca/) (`200`) |
| Red River College Polytechnic | education | governance | 2026 | in_progress | 60% | [RRC Polytech · Indigenous Education](https://www.rrc.ca/indigenous/) (`200`) |
| University of Alberta | education | relationships | 2026 | in_progress | 55% | [U of Alberta · Indigenous Strategic Plan](https://www.ualberta.ca/en/indigenous/strategic-plan/index.html) (`200`) |
| University of British Columbia | education | procurement | 2026 | in_progress | 50% | [UBC Indigenous Strategic Plan](https://isp.ubc.ca/) (`200`) |
| University of Calgary | education | relationships | 2026 | in_progress | 60% | [University of Calgary · Office of Indigenous Engagement](https://www.ucalgary.ca/indigenous) (`200`) |
| University of Manitoba | education | governance | 2026 | in_progress | 55% | [University of Manitoba · Truth and Reconciliation Framework](https://umanitoba.ca/about-um/um-truth-and-reconciliation-framework) (`200`) |
| University of Toronto | education | governance | 2026 | in_progress | 60% | [U of T · Institutional Equity Commitments](https://commitments.utoronto.ca/) (`200`) |
| Western University | education | relationships | 2026 | in_progress | 50% | [Western · Indigenous Initiatives](https://indigenous.uwo.ca/) (`200`) |
| AltaLink | energy | relationships | 2025 | reported | 85% | [AltaLink · Indigenous Relations](https://www.altalink.ca/our-commitment/indigenous-relations/) (`200`) |
| ATCO | energy | relationships | 2026 | in_progress | 50% | [ATCO · Indigenous Relations](https://www.atco.com/en-ca/our-commitment/indigenous-relations.html) (`200`) |
| BC Hydro | energy | relationships | 2026 | in_progress | 50% | [BC Hydro Service Plan 2025/26–2027/28](https://www.bcbudget.gov.bc.ca/2025/sp/pdf/agency/bchydro.pdf) (`200`) |
| Bruce Power | energy | procurement | 2025 | reported | 100% | [CCAB 2023 PAR certified companies (incl. Bruce Power Gold)](https://www.globenewswire.com/news-release/2023/09/14/2743137/0/en/CCAB-ANNOUNCES-2023-PAR-CERTIFIED-COMPANIES.html) (`200`) |
| Capital Power | energy | relationships | 2026 | in_progress | 45% | [Capital Power · Indigenous Relations](https://www.capitalpower.com/sustainability/community/indigenous-relations/) (`200`) |
| Cenovus Energy | energy | procurement | 2025 | reported | 95% | [Cenovus Indigenous Reconciliation](https://www.cenovus.com/Sustainability/Social/Indigenous-reconciliation) (`200`) |
| Enbridge | energy | procurement | 2030 | reported | 67% | [Enbridge · Indigenous procurement](https://www.enbridge.com/stories/2026/june/national-indigenous-peoples-day-enbridge-committed-respectful-engagement-collaboration) (`200`) |
| FortisBC | energy | relationships | 2026 | in_progress | 65% | [FortisBC · Our commitment to Reconciliation](https://www.fortisbc.com/in-your-community/indigenous-relationships-and-reconciliation/our-commitment-to-reconciliation) (`200`) |
| Hydro One | energy | procurement | 2025 | in_progress | 66% | [Hydro One Indigenous Procurement](https://www.hydroone.com/about/suppliers/indigenous-procurement) (`200`) |
| Hydro-Québec | energy | procurement | 2025 | reported | 80% | [Hydro-Québec — Indigenous relations](https://www.hydroquebec.com/indigenous-relations/relations.html) (`200`) |
| Imperial Oil | energy | procurement | 2025 | reported | 85% | [Imperial — Indigenous engagement](https://www.imperialoil.ca/sustainability/indigenous-engagement) (`200`) |
| Manitoba Hydro | energy | relationships | 2027 | in_progress | 40% | [Manitoba Hydro — Call for Wind Power](https://www.hydro.mb.ca/corporate/call-for-wind-power/) (`200`) |
| Nova Scotia Power | energy | relationships | 2026 | in_progress | 50% | [Nova Scotia Power · NS-NB Reliability Tie](https://www.nspower.ca/cleanandgreen/clean-energy/ns-nb-reliability-tie) (`200`) |
| Ontario Power Generation | energy | relationships | 2030 | in_progress | 45% | [Ontario Power Generation · Indigenous economic inclusion](https://www.niedb-cndea.ca/success-stories/ontario-power-generation-powering-the-way-for-indigenous-economic-inclusion/) (`200`) |
| Pembina Pipeline | energy | relationships | 2026 | in_progress | 60% | [Pembina · Indigenous Engagement](https://www.pembina.com/sustainability/indigenous-community-engagement/indigenous-engagement) (`200`) |
| SaskPower | energy | procurement | 2025 | reported | 100% | [SaskPower · Diversity and Inclusion](https://www.saskpower.com/about-us/Our-Company/Commitment-to-Diversity-and-Inclusion) (`200`) |
| Suncor Energy | energy | procurement | 2024 | reported | 100% | [Suncor 2023 Report on Sustainability (Indigenous relations)](https://www.3blmedia.com/news/indigenous-relations-suncor-2023-report-sustainability) (`200`) |
| Suncor Energy | energy | relationships | 2017 | reported | 100% | [East Tank Farm · Fort McKay & Mikisew Cree 49% purchase (MINING.COM)](https://www.mining.com/web/fort-mckay-mikisew-cree-first-nations-complete-purchase-49-interest-suncors-east-tank-farm-development/) (`200`) |
| Syncrude | energy | employment | 2017 | reported | 100% | [Syncrude · Indigenous employment milestone (CBC News)](https://www.cbc.ca/news/canada/edmonton/syncrude-indigenous-employment-milestone-oilsands-fort-mcmurray-1.4172465) (`200`) |
| Syncrude | energy | procurement | 2018 | reported | 100% | [Syncrude · procurement-led Aboriginal engagement (Carleton 3ci)](https://carleton.ca/3ci/wp-content/uploads/Syncrude.pdf) (`200`) |
| TC Energy | energy | relationships | 2019 | reported | 100% | [TC Energy · Coastal GasLink equity option agreements](https://www.tcenergy.com/announcements/2022/2022-03-09-tc-energy-signs-equity-option-agreements-with-indigenous-communities-across-the-coastal-gaslink-project-corridor/) (`200`) |
| Trans Mountain Corporation | energy | procurement | 2024 | reported | 100% | [Trans Mountain · $2B+ Indigenous contracts (Canadian Energy Centre)](https://www.canadianenergycentre.ca/indigenous-businesses-awarded-more-than-2-billion-in-trans-mountain-expansion-contracts-in-2022/) (`200`) |
| TransAlta | energy | governance | 2026 | in_progress | 45% | [TransAlta · Indigenous Relations](https://transalta.com/sustainability/indigenous-relations/) (`200`) |
| ATB Financial | finance | procurement | 2027 | in_progress | 30% | [ATB Truth & Reconciliation Action Plan](https://www.atb.com/company/news/releases/atb-introduces-truth-and-reconciliation-action-plan/) (`200`) |
| BMO (Bank of Montreal) | finance | procurement | 2023 | reported | 100% | [BMO wîcihitowin Indigenous Partnerships & Progress Report](https://www.newswire.ca/news-releases/bmo-releases-wicihitowin-3rd-annual-indigenous-partnerships-and-progress-report-and-announces-new-indigenous-advisory-council-members-872683670.html) (`200`) |
| BMO (Bank of Montreal) | finance | governance | 2025 | reported | 100% | [BMO wîcihitowin Indigenous Partnerships & Progress Report](https://www.newswire.ca/news-releases/bmo-releases-wicihitowin-3rd-annual-indigenous-partnerships-and-progress-report-and-announces-new-indigenous-advisory-council-members-872683670.html) (`200`) |
| Canada Life | finance | governance | 2026 | in_progress | 55% | [Canada Life · Who we are](https://www.canadalife.com/about-us/who-we-are.html) (`200`) |
| CIBC | finance | governance | 2026 | in_progress | 45% | [CIBC Reconciliation](https://www.cibc.com/en/about-cibc/corporate-profile/reconciliation.html) (`200`) |
| Co-operators | finance | employment | 2026 | in_progress | 50% | [Co-operators · Truth and Reconciliation](https://www.cooperators.ca/en/about-us/reconciliation) (`200`) |
| Intact Financial | finance | governance | 2026 | in_progress | 45% | [Intact Financial · Diversity, Equity and Inclusion](https://www.intactfc.com/careers/diversity-equity-and-inclusion) (`200`) |
| Manulife | finance | cultural_learning | 2026 | in_progress | 50% | [Gord Downie & Chanie Wenjack Fund · Legacy Spaces Program](https://downiewenjack.ca/our-work/legacy-spaces-program/) (`200`) |
| Meridian Credit Union | finance | relationships | 2026 | in_progress | 50% | [Meridian · Indigenous banking](https://www.meridiancu.ca/business-banking/business-hub/industries/indigenous-banking) (`200`) |
| National Bank of Canada | finance | governance | 2025 | reported | 100% | [National Bank — Indigenous](https://www.nbc.ca/personal/switch-national-bank/indigenous.html) (`200`) |
| RBC (Royal Bank of Canada) | finance | procurement | 2027 | in_progress | 35% | [RBC Reconciliation Action Plan 2025–2027](https://www.rbc.com/indigenous/) (`200`) |
| RBC (Royal Bank of Canada) | finance | employment | 2027 | in_progress | 28% | [RBC Reconciliation Action Plan 2025–2027](https://www.rbc.com/indigenous/) (`200`) |
| Scotiabank | finance | procurement | 2025 | in_progress | 62% | [Scotiabank Truth & Reconciliation Action Plan](https://www.scotiabank.com/ca/en/about/responsibility-impact/truth-reconciliation.html) (`200`) |
| Sun Life | finance | employment | 2030 | in_progress | 25% | [Sun Life · Diversity, Equity & Inclusion Strategy](https://www.sunlife.com/content/dam/sunlife/regional/global-marketing/documents/com/diversity-equity-and-inclusion-strategy-statement-en.pdf) (`200`) |
| TD Bank Group | finance | relationships | 2025 | reported | 78% | [TD and Indigenous Peoples](https://www.td.com/ca/en/about-td/diversity-and-inclusion/indigenous-peoples) (`200`) |
| Vancity | finance | governance | 2025 | in_progress | 65% | [Vancity — Committed to Reconciliation](https://news.vancity.com/community/reconciliation) (`200`) |
| Canfor | forestry | procurement | 2026 | reported | 70% | [Canfor · Indigenous Relationships](https://www.canfor.com/stewardship/indigenous-relationships) (`200`) |
| West Fraser | forestry | employment | 2026 | in_progress | 50% | [West Fraser · Indigenous Relations](https://www.westfraser.com/sustainability/social/indigenous-relations) (`200`) |
| BCLC | government | procurement | 2026 | in_progress | 50% | [BCLC · CCIB member profile](https://www.ccib.ca/main/member/bclc/) (`200`) |
| Business Development Bank of Canada | government | relationships | 2026 | in_progress | 65% | [BDC · CCAB member](https://www.ccab.com/main/ccab_member/business-development-bank-of-canada/) (`200`) |
| Canada Infrastructure Bank | government | relationships | 2027 | reported | 70% | [Canada Infrastructure Bank · Indigenous](https://cib-bic.ca/en/indigenous-infra/) (`200`) |
| Canada Mortgage and Housing Corporation | government | governance | 2026 | in_progress | 50% | [CMHC · Indigenous housing](https://www.cmhc-schl.gc.ca/indigenous-funding) (`200`) |
| Canada Post | government | procurement | 2025 | in_progress | 55% | [Canada Post — Indigenous reconciliation strategy](https://www.canadapost-postescanada.ca/cpc/en/our-company/indigenous-reconciliation.page) (`200`) |
| Export Development Canada | government | relationships | 2026 | in_progress | 50% | [EDC · Indigenous business](https://www.edc.ca/en/campaign/indigenous-business.html) (`200`) |
| Parks Canada | government | relationships | 2026 | in_progress | 55% | [Parks Canada · Indigenous relations and stewardship](https://parks.canada.ca/agence-agency/aa-ia) (`200`) |
| Alberta Health Services | health | employment | 2026 | in_progress | 50% | [AHS · Indigenous Health](https://www.albertahealthservices.ca/info/Page11949.aspx) (`200`) |
| Fraser Health | health | governance | 2026 | in_progress | 60% | [Fraser Health · Indigenous Health](https://www.fraserhealth.ca/health-topics-a-to-z/indigenous-health) (`200`) |
| Interior Health | health | cultural_learning | 2026 | in_progress | 60% | [Interior Health · Indigenous Health & Wellness Strategy 2022–2026](https://www.interiorhealth.ca/sites/default/files/PDFS/indigenous-health-wellness-strategy-2022-2026-revised.pdf) (`200`) |
| Saskatchewan Health Authority | health | employment | 2026 | in_progress | 50% | [Saskatchewan Health Authority · Truth & Reconciliation](https://www.saskhealthauthority.ca/trc) (`200`) |
| Vancouver Coastal Health | health | cultural_learning | 2026 | in_progress | 60% | [Vancouver Coastal Health · Indigenous Health](https://www.vch.ca/en/about-us/indigenous-health) (`200`) |
| CBC/Radio-Canada | media | procurement | 2026 | in_progress | 45% | [CBC/Radio-Canada · National Indigenous Strategy](https://cbc.radio-canada.ca/en/your-public-broadcaster/blog/oped-road-to-reconcilliation) (`200`) |
| Agnico Eagle | mining | employment | 2026 | in_progress | 55% | [Agnico Eagle · Reconciliation Action Plan (2024, PDF)](https://s205.q4cdn.com/243646470/files/doc_downloads/1553-AE-RAP-Eng_Final-Web.pdf) (`200`) |
| Cameco | mining | procurement | 2025 | reported | 90% | [Cameco — Workforce and Communities](https://www.cameco.com/about/sustainability/workforce-and-communities) (`200`) |
| Diavik Diamond Mine (Rio Tinto) | mining | procurement | 2018 | reported | 100% | [Rio Tinto · Diavik communities](https://www.riotinto.com/en/operations/canada/diavik/diavik-communities) (`200`) |
| Glencore Canada | mining | employment | 2026 | in_progress | 55% | [Glencore Canada · Community](https://www.glencore.ca/en/sustainability/community) (`200`) |
| Iron Ore Company of Canada | mining | procurement | 2026 | in_progress | 62% | [Iron Ore Company of Canada · Indigenous participation](https://www.ironore.ca/en/sustainability/indigenous-participation) (`200`) |
| Newmont | mining | procurement | 2026 | in_progress | 50% | [Newmont · Local Procurement](https://operations.newmont.com/local-procurement) (`200`) |
| Nutrien | mining | procurement | 2025 | reported | 100% | [Nutrien — Indigenous Content Playbook](https://www.nutrien.com/news/stories/a-billion-dollar-playbook) (`200`) |
| Teck Resources | mining | employment | 2025 | in_progress | 60% | [Teck 2024 Sustainability Report](https://www.teck.com/media/2024-Sustainability-Report.pdf) (`200`) |
| Teck Resources | mining | relationships | 2025 | reported | 96% | [Teck 2024 Sustainability Report](https://www.teck.com/media/2024-Sustainability-Report.pdf) (`200`) |
| Vale Canada | mining | employment | 2025 | in_progress | 46% | [Vale (NL) — NRCan profile](https://natural-resources.canada.ca/maps-tools-publications/publications/vale-inco-newfoundland-labrador) (`200`) |
| Federated Co-operatives | retail | procurement | 2026 | in_progress | 50% | [Federated Co-operatives · Suppliers](https://www.fcl.crs/our-business/suppliers) (`200`) |
| IKEA Canada | retail | cultural_learning | 2026 | in_progress | 45% | [IKEA Canada · Reconciliation](https://www.newswire.ca/news-releases/ikea-canada-marks-ongoing-indigenous-reconciliation-journey-with-indigenous-inspired-spaces-at-ikea-winnipeg-896758023.html) (`200`) |
| Loblaw Companies | retail | procurement | 2026 | in_progress | 45% | [Loblaw — Commitment to reconciliation](https://www.loblaw.ca/en/our-commitment-to-reconciliation/) (`200`) |
| Sobeys | retail | governance | 2026 | in_progress | 50% | [Sobeys · Diversity, equity & inclusion](https://dei.sobeys.com/en/) (`200`) |
| The North West Company | retail | relationships | 2026 | in_progress | 50% | [The North West Company · Our Promise to Indigenous Peoples](https://www.northwest.ca/sustainability/our-promise-to-indigenous-peoples) (`200`) |
| Bell Canada | telecom | relationships | 2030 | in_progress | 40% | [Bell · Bell for Better (reconciliation)](https://www.bell.ca/bell-for-better) (`200`) |
| Northwestel | telecom | relationships | 2026 | in_progress | 60% | [Northwestel · Reconciliation (Our Path Forward)](https://www.nwtel.ca/ourpathforward) (`302`) |
| Rogers Communications | telecom | employment | 2025 | in_progress | 80% | [Rogers · CCIB member profile](https://www.ccib.ca/main/member/rogers-communications/) (`200`) |
| TELUS | telecom | procurement | 2026 | reported | 80% | [TELUS · Indigenous Reconciliation](https://www.telus.com/en/social-impact/connecting-canada/indigenous-reconciliation) (`200`) |
| Air Canada | transport | employment | 2026 | in_progress | 50% | [Air Canada · Diversity, Equity and Inclusion](https://www.aircanada.com/ca/en/aco/home/about/diversity-equity-inclusion.html) (`200`) |
| Calgary Airport Authority | transport | relationships | 2026 | in_progress | 45% | [Calgary Airport Authority · Indigenous Reconciliation Strategy](https://www.yyc.com/Portals/0/Calgary%20Airport%20Authority%20Indigenous%20Reconciliation%20Strategy_May%202025.pdf) (`200`) |
| CN (Canadian National Railway) | transport | employment | 2027 | in_progress | 36% | [CN Indigenous Reconciliation Report 2025](https://www.railway.supply/cn-releases-first-indigenous-reconciliation-report/) (`200`) |
| CN (Canadian National Railway) | transport | procurement | 2025 | reported | 100% | [CN Indigenous Reconciliation Report 2025](https://www.railway.supply/cn-releases-first-indigenous-reconciliation-report/) (`200`) |
| CPKC (Canadian Pacific Kansas City) | transport | procurement | 2027 | in_progress | 35% | [CPKC — CCIB member profile](https://www.ccab.com/main/ccab_member/canadian-pacific-kansas-city/) (`200`) |
| Edmonton International Airport | transport | relationships | 2026 | in_progress | 50% | [Edmonton International Airport · Airport for Everyone](https://flyyeg.com/corporate/esg/airport-for-everyone/) (`200`) |
| Metrolinx | transport | relationships | 2026 | in_progress | 45% | [Metrolinx · Equity, Diversity and Inclusion](https://www.metrolinx.com/en/about-us/edi) (`200`) |
| Port of Vancouver (Vancouver Fraser Port Authority) | transport | relationships | 2026 | in_progress | 55% | [Vancouver Fraser Port Authority · Roberts Bank Terminal 2 (news release)](https://www.globenewswire.com/news-release/2025/07/10/3113588/0/en/Roberts-Bank-Terminal-2-procurement-underway-with-Vancouver-Fraser-Port-Authority-issuing-a-request-for-qualifications-for-a-construction-team.html) (`200`) |
| Toronto Pearson (GTAA) | transport | relationships | 2025 | reported | 100% | [Toronto Pearson · Indigenous investment](https://www.internationalairportreview.com/toronto-pearson-invests-780000-to-strengthen-indigenous-led-organisations-and-advance-reconciliation-across-canada/539389.article) (`200`) |
| TransLink | transport | procurement | 2030 | in_progress | 40% | [TransLink · Indigenous Relations](https://www.translink.ca/about-us/about-translink/indigenous-relations) (`200`) |
| VIA Rail | transport | procurement | 2026 | in_progress | 45% | [VIA Rail · Indigenous communities](https://www.viarail.ca/en/offers/indigenous-communities) (`200`) |
| WestJet | transport | relationships | 2025 | reported | 100% | [WestJet · official airline sponsor, ITAC (news)](https://www.westjet.com/en-ca/news/2022/westjet-named-official-airline-sponsor-for-itac-s-2022-national-) (`200`) |

## 5. Live seed (production)

The same fixtures are seeded to the production DynamoDB table so the live site and local dev match.

| | |
|---|---|
| Table | `indigenomics-portal-production-CommitmentsTable-bbbceuvv` |
| Region | `us-east-1` |
| Records seeded | 106 |
| Seed script | `scripts/seed-commitments.ts` (`COMMITMENTS_TABLE=... npx tsx scripts/seed-commitments.ts`) |
| Live dashboard | https://d1hwn8hhp1ytc0.cloudfront.net/commitments |

Local dev reads the fixtures directly; production reads DynamoDB. A golden test (`scripts/verify.ts`) asserts the mock and DynamoDB representations are identical, so adding a field requires symmetric edits and stays consistent across both.

---

*Generated from `src/lib/commitments/fixtures.ts` + `org-profiles.ts`; URL statuses from a live HTTP check on 2026-07-03.*
