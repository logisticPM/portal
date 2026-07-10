# Data Verification & Master Source List — `Indigenomics_Data_Portal_Research_v1.xlsx`

**Prepared:** 2026-06-29 · CS7980 capstone · **Scope:** all 5 sheets of the teammate's research workbook
**Method:** every notable figure fact-checked against primary public sources (company ESG reports, `open.canada.ca` ISC 5% dataset + CSV, Canada Energy Regulator Market Snapshot 2026, AIOC / CILGC / CDEV, NACCA, Conference Board of Canada, NRCan ESTMA, CCIB PAIR registry).

> **How to use this doc.** This is the team's living tracking record for the RAP/data corpus — the verified figures, their primary sources (§2), and the RAP PDFs available for the extraction pipeline (§4). As the collected-plan set grows (a ~100-RAP corpus is now being assembled), extend §2 and §4 rather than starting a new list, so there's a single source of truth for provenance.

> **Overall verdict: the dataset is largely accurate and unusually well-sourced.** The federal procurement table reproduces the source CSV to the dollar, and most marquee equity/financing figures confirm against primary sources. There is **one headline-level error** and a short list of labeling / staleness fixes to make before this is presented as authoritative.

---

## 1. Fix list (do these before publishing)

> **Status (2026-07-10):** Every fix below that touches a **seeded** org is already applied in `src/lib/rap/real-fixtures.ts` (the raptest 10-org seed) — federal 5%→6.11% (#1), Enbridge $757M cumulative (#5,#12), TELUS 500 ha (#14), Teck "in development" (#15), Suncor 14.25%, TC Energy 92% (2023), Agnico $4.6M. The remaining items (Cedar LNG partner #2/#3, Northern Courier #7, AIOC $393M→$745M #8, FNFA rating #9, FNFMB #10, NACCA #17, and the equity/financing minors) target orgs **not yet seeded anywhere** — they live only in the source workbook. Treat this list as the **corrections-to-apply checklist** for if/when those equity/financing orgs are added to the RAP-extraction seed. (Ref: issue #96 closed — the two source docs cover different domains and were intentionally kept separate.)

### High-impact — wrong / reversed
| # | Sheet | Issue | Correction |
|---|-------|-------|-----------|
| 1 | Federal 5% | Government-wide rate shown as **"~4.6%, near/below target"** | **Actual = 6.11%, which EXCEEDED 5%.** $1.241B ÷ ($35.016B − $14.701B). 4.6% matches no calculation and the direction is reversed. **This flips the headline conclusion.** |
| 2 | Equity | Cedar LNG partner = **"Tahltan Central Government"** | Partner is the **Haisla Nation (50.1%)** — world's first Indigenous-majority LNG. Tahltan is not involved. |
| 3 | Equity | Cedar LNG $200M funder = **"NRCan"** | Funder is **ISED / Strategic Innovation Fund**. |
| 4 | ESG | Suncor **"63 Petro-Canada sites"** in the *# Indigenous suppliers* row | Mislabel — 63 = retail/wholesale community business arrangements, **not** a supplier count. Relabel or remove from that row. |
| 5 | ESG | Enbridge **"$757M new (2023)"** as an annual figure | $757M is **cumulative since 2023** toward the 2023–2030 $1B target, not single-year. Reword. |
| 6 | ESG | TELUS Nisga'a network = **"co-ownership"** | Infrastructure is **Nisga'a-owned** (Lisims Internet); TELUS builds + trains. Remove "co-ownership." |
| 7 | Equity | Northern Courier value = **$1.3B** | Unsupported; build cost ≈ C$800M. Re-source or drop the figure. |

### Medium — stale / understated / needs date-stamp
| # | Sheet | Issue | Correction |
|---|-------|-------|-----------|
| 8 | Financing | AIOC **"$393M total"** | Captures only the first 3 deals; cumulative is **$745M+** (43 Nations, 9 deals, vs $3B cap). Relabel "first three deals (2021–23)" or update. |
| 9 | Financing | FNFA **"AAA-equivalent"** | Overstates. Actual **S&P AA- / Moody's Aa3**. Say "AA-/Aa3, near municipal/provincial rates." |
| 10 | Financing | FNFMB **"~350 certified"** | Conflates categories. ~350 = FNs *scheduled* under the FMA; **Financial-Performance-certified ≈ 248**. Use the specific category. |
| 11 | Equity | Access NGL partner **"Northern Lakehead"** | Authoritative spelling is **"Northern Lakeland Indigenous Alliance"** (the CER snapshot itself carries the "Lakehead" typo). |
| 12 | ESG | Enbridge IRAP **"10 met"** of 22 | Stale — **12 of 22** met by end-2024; superseded by the 2025 Refresh's 20 new commitments. |
| 13 | ESG | Agnico **"first Canadian mining RAP"** | Overstates a hedged self-assertion. Use "first Canadian-**based-and-led** miner to publish a RAP (self-asserted, Jul 2024)." |
| 14 | ESG | TELUS "300 ha" / "6th edition" | Now **500 ha** (Piikani + Blood Tribe); latest report is the **7th** (Nov 2025). |
| 15 | ESG | Teck RAP **"Published"** | Unconfirmed — Teck committed to *developing* a RAP; no standalone document found. Downgrade to "in development." |
| 16 | All ESG | Figures not date-stamped | Suncor $3.1B/20% = 2022; TC Energy $1.8B + 92% training = 2023; Teck $388M/$32M = 2023 (23rd ed.) while the 24th-ed report is 2024. **Date every annual figure** — mixing report-edition year with data year is the recurring trap. |
| 17 | Financing | NACCA **"50 IFIs"** | NACCA says "50+" (actual ~51–59). Use "50+". |

### Minor / footnote-only
- **DND "did not meet 5%"** is formula-true but DND is Phase 3 (deadline FY2024-25, not 2023-24) — footnote.
- **Suncor 14.25%** = effective Indigenous stake (95% of Astisiy's 15% gross) — footnote, don't conflate with 15%.
- **Astisiy** = 3 First Nations + 5 Métis, not "8 First Nations."
- **CNQ "80+"** communities → CNRL states a flat "80."
- **Kitikmeot Tugliq** is an **LP**, not "Ltd."; Hope Bay wind = **4.2 MW** (not 4 MW).
- **Prince Rupert Gas / Ksi Lisims** are more advanced than "proposed" (EA/FID milestones 2025–26).
- **Ksi Lisims operator** "NW LNG Alliance" unverified — it's a Western LNG subsidiary.

### Unverified but NOT proven wrong (flag, don't delete)
- **NGTL/TC Energy "terminated Feb 6, 2025"** — collapse is well-documented and the deal is absent from CER's 2026 completed list, but the **exact date** couldn't be confirmed. Status "terminated/did not close" is supported.
- **NACCA 2.1% loss rate (FY2019-20)** — source PDF was 403-blocked. NACCA elsewhere cites ~97% repayment (~3% loss).

---

## 2. Master source list (deduplicated)

The workbook already cites its origins per-sheet; this is the consolidated, verified list with full URLs.

### A. Government / regulator datasets (the "hard" verified layer)
1. ISC — *Results of the Mandatory Minimum 5% Indigenous Procurement Target, FY2023-24* (dataset landing): https://open.canada.ca/data/en/dataset/5d27d152-09d8-4303-adc4-0c46b4a9733b
2. ISC 5% target — per-department source **CSV**: https://open.canada.ca/data/dataset/5d27d152-09d8-4303-adc4-0c46b4a9733b/resource/a0dec98d-de1e-49b9-ad7f-ef61461b56e5
3. ISC — FY2023-24 narrative report: https://www.sac-isc.gc.ca/eng/1761738280117/1761738313724
4. ISC — Mandatory 5% target program page: https://www.sac-isc.gc.ca/eng/1691786841904/1691786863431
5. ISC — Evaluation of the Indigenous Entrepreneurship & Business Development Program (4,650 FTE/yr): https://www.sac-isc.gc.ca/eng/1717168968031/1717169061719
6. Canada Energy Regulator — Market Snapshot 2026, *Growing Indigenous ownership in Canadian pipelines and LNG facilities* (the "5,000+ km" headline; equity sheet backbone): https://www.cer-rec.gc.ca/en/data-analysis/energy-markets/market-snapshots/2026/market-snapshot-growing-indigenous-ownership-in-canadian-pipelines-and-lng-facilities.html
7. NRCan — ESTMA database / reports: https://natural-resources.canada.ca/corporate/transparency/acts-regulations/extractive-sector-transparency-measures-act
8. NRCan — Hope Bay mine groundbreaking / SREP $25M (May 2026): https://www.canada.ca/en/natural-resources-canada/news/2026/05/government-of-canada-marks-groundbreaking-at-hope-bay-mine.html
9. ISED — Support for Cedar LNG ($200M via Strategic Innovation Fund, Mar 2025): https://www.canada.ca/en/innovation-science-economic-development/news/2025/03/government-of-canada-announces-support-for-cedar-lng.html
10. NRCan — Launch of the $5B Indigenous Loan Guarantee Program (Feb 2025): https://www.canada.ca/en/natural-resources-canada/news/2025/02/government-of-canada-celebrates-launch-of-the-5-billion-indigenous-loan-guarantee-program.html
11. CDEV — Indigenous Loan Guarantee Program: https://cdev.gc.ca/indigenous-loan-guarantee-program/
12. CDEV — First loan guarantee (Stonlasec8) celebrated: https://cdev.gc.ca/federal-indigenous-loan-guarantee-program-celebrates-first-loan-guarantee/
13. CILGC / CGPAC — program page ($20M–$1B range; s.35 eligibility): https://cilgc-cgpac.ca/en/program
14. House of Commons — FINA brief, First Nations Finance Authority (FMB certification stats): https://www.ourcommons.ca/Content/Committee/441/FINA/Brief/BR13229855/br-external/FirstNationsFinanceAuthority-e.pdf
15. Canada.ca — Major Projects Office, Ksi Lisims LNG: https://www.canada.ca/en/privy-council/major-projects-office/projects/national/ksi-lisims.html

### B. Indigenous institutions / financing ecosystem
16. NACCA — Indigenous Financial Institutions overview ($3.2B / 50,000 loans / 50+ IFIs): https://nacca.ca/indigenous-financial-institutions/
17. NACCA — List and types of IFIs: https://nacca.ca/indigenous-financial-institutions/list-and-types-of-ifis/
18. NACCA — Conference Board of Canada report (3.6× GDP multiplier): https://nacca.ca/conference-board-of-canada-report/
19. NACCA — CBoC Impact Summary Report (PDF): https://nacca.ca/wp-content/uploads/2023/10/NACCA_CBOC_Impact_Summary_Report.pdf
20. NACCA — Indigenous Growth Fund ($153M): https://nacca.ca/igf/
21. NACCA — 2023-24 Annual Report (via NationTalk): https://nationtalk.ca/story/the-2023-2024-annual-report-from-the-nacca
22. AIOC — Alberta Indigenous Opportunities Corporation: https://theaioc.com/
23. AIOC — Athabasca "Project Rocket" $250M guarantee (Sep 2022): https://theaioc.com/2022/09/28/aioc-project-rocket-partnership-announcement/
24. AIOC — $103M Access NGL guarantee (Jul 2023): https://theaioc.com/2023/07/27/alberta-indigenous-opportunities-corporation-provides-103-million-loan-guarantee-to-facilitate-multi-generational-economic-benefits-for-five-first-nations-and-metis-communities-in-alberta/
25. FNFA — S&P upgrade to AA- (Oct 2024): https://www.fnfa.ca/en/first-nations-finance-authority-fnfa-credit-rating-raised-to-aa-by-sp-global-ratings/
26. Moody's — FNFA credit rating (Aa3): https://www.moodys.com/credit-ratings/First-Nations-Finance-Authority-credit-rating-808090362
27. FNFMB — Financial Management System certification: https://fnfmb.com/en/services/certify-first-nations/financial-management-system-certification
28. BDC — IGF first round $150M: https://www.bdc.ca/en/about/mediaroom/news-releases/indigenous-growth-fund-raises-150m-first-round-support-indigenous-entrepreneurs-canada

### C. Certification / industry bodies
29. CCIB — PAIR registry, TELUS member page (PAIR-SILVER): https://www.ccib.ca/main/member/telus-communications-inc/

### D. Company & project sources (Corporate ESG + Equity sheets)
30. Suncor — 2023 Report on Sustainability ($3.1B/20%/63 sites): https://www.3blmedia.com/news/indigenous-relations-suncor-2023-report-sustainability
31. Suncor — Northern Courier / Astisiy announcement (2021): https://www.globenewswire.com/news-release/2021/09/16/2298240/0/en/Suncor-and-eight-Indigenous-communities-announce-the-acquisition-of-the-Northern-Courier-Pipeline.html
32. Enbridge — 2025 Indigenous RAP Refresh, Pillar 3 ($757M/$2.757B): https://www.enbridge.com/reports/2025-indigenous-reconciliation-action-plan-refresh/pillar-3-economic-inclusion-partnerships
33. Enbridge — 2022 inaugural IRAP (22 commitments): https://www.enbridge.com/reports/2022-indigenous-reconciliation-action-plan/about-this-irap
34. Enbridge — Athabasca Indigenous Investments (oilsands, 2022): https://www.enbridge.com/media-center/news/details?id=123735
35. Enbridge — Stonlasec8 / Westcoast 12.5% (Jul 2025): https://www.enbridge.com/media-center/news/details?id=123853
36. TC Energy — Indigenous page ($1.8B 2023; 92% training): https://www.tcenergy.com/sustainability/indigenous/
37. TC Energy — "Canada's largest Indigenous equity ownership agreement," NGTL/Foothills (Jul 2024): https://www.tcenergy.com/announcements/2024/2024-07-30-tc-energy-announces-canadas-largest-indigenous-equity-ownership-agreement/
38. TC Energy — Prince Rupert Gas Transmission: https://www.tcenergy.com/operations/natural-gas/prince-rupert-gas-transmission-project/
39. Canadian Natural — Indigenous Relations ($855M / 212 businesses, 2024): https://www.cnrl.com/sustainability/communities/indigenous-relations/
40. Teck — 2023 sustainability performance ($388M / $32M): https://www.globenewswire.com/news-release/2024/03/14/2846753/0/en/teck-reports-2023-sustainability-performance.html
41. Agnico Eagle — Q1 2024 results (~$1B Indigenous / $16M community): https://www.prnewswire.com/news-releases/agnico-eagle-reports-first-quarter-2024-results-302127907.html
42. Agnico Eagle — Reconciliation Action Plan page (Jul 2024): https://www.agnicoeagle.com/English/sustainability/Reconciliation-Action-Plan/default.aspx
43. Agnico Eagle — 2024 ESTMA report ($90M): https://s205.q4cdn.com/243646470/files/doc_downloads/estma/AEM-ESTMA-2024.pdf
44. RBC — inaugural RAP "Pathways to Economic Prosperity" (Jun 2025): https://www.newswire.ca/news-releases/rbc-marks-national-indigenous-history-month-with-the-launch-of-its-inaugural-reconciliation-action-plan-865731071.html
45. TELUS — first tech-company RAP commitment (Nov 2021): https://www.globenewswire.com/en/news-release/2021/11/29/2342430/0/en/TELUS-becomes-first-technology-company-in-Canada-to-publicly-commit-to-an-Indigenous-reconciliation-action-plan.html
46. TELUS — 2025 Indigenous Reconciliation & Connectivity Report (7th ed.; 500 ha): https://www.newswire.ca/news-releases/telus-launches-2025-indigenous-reconciliation-and-connectivity-report-827437817.html
47. Barrick Gold — 2024 Sustainability Report (global local spend; no RAP): https://www.barrick.com/files/doc_downloads/sustainability/Barrick_Sustainability_Report_2024.pdf
48. Wolf Midstream — Northern Lakeland Indigenous Alliance / Access NGL: https://wolfmidstream.com/northern-lakeland-indigenous-alliance-and-wolf-midstream-announce-equity-partnership-access-ngl/
49. Tamarack Valley — Clearwater Infrastructure LP ($172M / 85%): https://www.newswire.ca/news-releases/indigenous-communities-and-tamarack-valley-energy-announce-clearwater-infrastructure-limited-partnership-859186983.html
50. Cedar LNG — project page (Haisla 50.1%): https://www.cedarlng.com/project/
51. Ksi Lisims LNG — project page: https://www.ksilisimslng.com/project

---

*Per-claim verification tables (39 ESG/procurement claims + 25 equity/financing claims, each marked CONFIRMED / PARTIAL / UNVERIFIED / INCORRECT with evidence) are preserved in the working notes and can be appended as an annex on request.*

---

## 3. Real-data seed loaded into the live dashboard (us-east-1, 2026-07-01)

The verified figures above were mapped into the RAP schema and seeded into the **us-east-1 (`raptest`) stack** as the *real-only* dataset (Option A — the synthetic demo seed was wiped first). Code: `portal/src/lib/rap/real-fixtures.ts` + `portal/scripts/seed-rap-real.ts`. **10 organizations · 24 commitments**, every figure traceable to a primary source (URL stored on each commitment's provenance). Live: https://d2yobeih1s2eg8.cloudfront.net/rap/explore

| Org | Sector | Real figures seeded (claim basis) |
|---|---|---|
| Bank of Canada | finance | RAP (2024) — People/Learning pathways (qualitative; self-reported) |
| Royal Bank of Canada | finance | Inaugural RAP "Pathways to Economic Prosperity" (Jun 2025; self-reported) |
| TELUS | telecom | RAP (2021, first tech) · **PAIR Silver** (independently verified) · 500 ha land |
| Agnico Eagle | mining | RAP (Jul 2024) · ~$1B procurement · $16M community · $4.6M training · **$90M ESTMA** (statutory) |
| Enbridge | energy | 22-goal IRAP · **$1B procurement target by 2030** ($2.757B cumulative) · Athabasca equity $1.12B |
| Suncor | energy | $3.1B procurement / 20% · Astisiy 14.25% equity |
| TC Energy | energy | $1.8B procurement · 92% cultural-training completion |
| Canadian Natural | energy | $855M+ procurement / 212 businesses · 80+ community relationships |
| Teck | mining | $388M procurement · $32M community (RAP in development) |
| Government of Canada | government | **Mandatory 5% procurement — achieved 6.11%** ($1.241B); NRCan 17.0% (statutory) |

Values marked "reported achievement" carry status **met**; forward targets (Enbridge $1B-by-2030, BoC pathways) carry **on_track**. Claim-basis badges: `statutory` (federal 5%, ESTMA), `independently_verified` (TELUS PAIR), else `self_reported`.

---

## 4. Downloadable RAP PDFs — for testing the extraction pipeline

Verified live (HTTP 200, `application/pdf`). The first three are downloaded into `Week 7/rap_samples/`; see that folder's README for test guidance.

| Document | Pages / size | Downloaded? | URL |
|---|---|---|---|
| **Bank of Canada — RAP** | 17 pp · 524 KB | ✅ (best baseline) | https://www.bankofcanada.ca/wp-content/uploads/2024/09/reconciliation-action-plan.pdf |
| **RBC — "Pathways to Economic Prosperity" RAP** | 35 pp · 17 MB | ✅ (large, image-heavy) | https://www.rbc.com/indigenous/_assets-custom/pdfs/reconciliation-action-plan-EN.pdf |
| **Agnico Eagle — ESTMA 2024** (statutory) | 7 pp · 204 KB | ✅ (small, tabular) | https://s205.q4cdn.com/243646470/files/doc_downloads/estma/AEM-ESTMA-2024.pdf |
| Barrick — 2024 Sustainability Report | ~13 MB | — | https://www.barrick.com/files/doc_downloads/sustainability/Barrick_Sustainability_Report_2024.pdf |
| NACCA — Conference Board Impact Summary | PDF | — | https://nacca.ca/wp-content/uploads/2023/10/NACCA_CBOC_Impact_Summary_Report.pdf |
| First Nations Finance Authority — FINA brief | 300 KB | — | https://www.ourcommons.ca/Content/Committee/441/FINA/Brief/BR13229855/br-external/FirstNationsFinanceAuthority-e.pdf |

**Note on other real RAPs:** RBC and Bank of Canada publish their RAPs as single downloadable PDFs (ideal for extraction). Several others (Enbridge IRAP, TELUS Reconciliation & Connectivity Report, Agnico's RAP narrative) are published as **web pages / micro-sites** rather than one PDF — their *figures* are seeded above and sourced in §2, but there is no single-file PDF to feed the extractor. For Australian-style formal RAP PDFs (Reflect/Innovate/Stretch/Elevate), Reconciliation Australia's registry is the canonical source if broader test material is wanted later.
