# 法律案例语料构建方法论（学术界怎么做）+ 对 A2AJ 摄取管道的修正

> 研究日期：2026-06-28。聚焦"**语料构建**"方法论（不是检索算法），用于校准 Phase 2-A 的 A2AJ 摄取设计。每条结论有来源；`[推断]` 标注综合判断。

## 核心母题
严谨的实证法律研究把"**纳入哪些案例**"当作最关键、也最难复现的设计决策。Hall & Wright 的信度测试发现：编码可以达成一致，但**案例选择**才是可复现性的薄弱环节。而任何法律语料都坐在两层上游过滤之上——哪些纠纷会进入诉讼（Priest–Klein）、哪些判决会被公布（Siegelman–Donohue）——所以语料必须声明它代表"冰山的哪一层"。

## 1. 总体定义与案例选择（四种策略 + 偏差）
- **关键词/布尔检索**：最常用、最被高估。Blair & Maron (1985)：熟练律师自认召回 ≥75%，实测 **~20%**。→ 关键词召回低且非随机，会静默丢掉大部分相关案例。
- **引文器选择（noting up，Shepard's/KeyCite/BCite）**：从种子案沿引用网扩。Hellyer (2018)：三家引文器各漏/误标约 1/3，仅 53 条全一致。→ 覆盖有缺口、依赖所用引文器、偏向高被引（上诉/已公布）节点。
- **专家手工策展**："X 领域的代表案"。可复现性差、有正典/确认偏差，偏famous上诉地标。
- **从定义好的总体随机抽样**：理想，但只相对**抽样框**去偏；框若是"已公布判决"，你得到的是有偏总体的无偏估计。
- **可整体普查**：案例法有界，有时可分析**整个总体**而非抽样（Hall & Wright）。

**系统综述方法引入法律**：Hall & Wright (2008) 的 "Systematic Content Analysis" 是标准参考（定义总体→抽样→训练编码员→测信度 kappa→分析）。PRISMA（identified→screened→excluded-with-reasons→included 流程图）正在迁入法律，但**没有公认的"PRISMA-for-case-law"法学综述论文**。

**主流法律 NLP 基准实际怎么建的**（几乎都绕开了随机抽样理想）：
- COLIEE（加拿大联邦法院，单一商业源 vLex）= **引文为正例** + 随机负例 + 两名专家人工查错。
- CLERC（建在 CAP）= **文内引用图**，relevance=引用指向，**无人工判定**，~12% 引用抽取错误。
- CaseHOLD = 从 "(holding that…)" **括注**自动抽取 53k 标签。
- Caselaw Access Project = **普查**（哈佛馆藏纸本 reporter ~650 万），但只相对"已公布"记录全面。
- Pile of Law = 批量摄入 35+ 公开源，**自身未做去重**（我们可以做得比它好）。

**种子 + 引用滚雪球**：Wohlin (2014) 从"start set"前后向扩。**结构上够不到未被引用的案例**→系统性排除未公布/初审/最新判决；偏好附着放大地标案。文献里的缓解=**混合**：穷尽查询锚定总体 + 滚雪球补查询遗漏（Mohammadi et al. 2024）。

## 2. 主题/议题标注（规模化）
- **人工专家标注 + 信度**：写指南→多人独立标→**卡帕**（Cohen/Fleiss/Krippendorff α）。阈值：Landis–Koch **0.61–0.80=substantial**（但标签是"任意"的、需谨慎）；α≥0.80 惯例、0.667 下限。**卡帕悖论**（Feinstein–Cicchetti）：标签分布偏斜时观察一致 95% 但 kappa≈0 → 须同时报 prevalence/bias。法律标注通常落 0.6–0.7。**单标签/案的还原论是真陷阱**（Shapiro "Coding Complexity"：重编码平均 3.7 议题/案，远超官方单码）。
- **弱/远监督 + 复用既有分类**：West Key Number（专有、无开放 ML 数据集）、EuroVoc、ECtHR 条款、catchwords 直接当标签。
- **LLM 辅助标注 + 验证**：Gilardi et al. (2023, PNAS) ChatGPT 零样本超众包 ~25 分、便宜 30×。**但**：Reiss (2023) 提示词/重复输入都不稳定；Ziems et al. (2024) 分类任务仅"fair"一致、不超微调模型；**法律专门**：Savelka & Ashley (2023) 零样本 GPT-4 F1=**0.82**（判决修辞角色）/**0.90**（合同条款）/**仅 0.54**（法条），明确"keep a human-expert in the loop"。

## 3. 质量控制与验证
- **去重**：精确（suffix array）+ 近重（**MinHash + LSH**）。法律专门：**平行引用**（同判决多 reporter→近重，精确匹配会漏、MinHash 能抓）；**多级判决（初审→上诉→SCC、多数/异议）不是重复，必须保留**——去重要在正确粒度。
- **金标准验证**：对未见过的人工标注集算 **precision/recall/F1**。关键：**recall 只有当金样本抽自整个总体（而非系统选中的）时才能估**，否则永远看不到它漏掉的。
- **估计语料纯度**：Cochran n₀=Z²p(1−p)/e²。95% 置信、±5%、p=0.5 → **n≈384** 手查（大总体近似常数）；用 **Wilson 区间**（非 Wald），尤其接近 0/100% 时。分层（按法院/主题）则每层 ~384。

## 4. 文档与可复现标准
- **Datasheets for Datasets**（Gebru et al. 2018/2021）：Motivation/Composition/Collection/Preprocessing/Uses/Distribution/Maintenance。
- **Data Statements for NLP**（Bender & Friedman 2018）；**Model/Data Cards**。
- **实证法律报告规范**：Epstein & King (2002) "The Rules of Inference"——法律学者做实证"对推断规则知之甚少"；**复现标准**=报告数据/测量/流程使第三方可复现。未披露的分析选择（变量操作化、纳入规则）会膨胀假阳性，透明是解药。

## 5. 原住民/公法专门
- **咨询义务集**：**没有权威的有界公开数据集**。CIRNAC 的 ATRIS 跟踪的是咨询**义务**不是判例。律所/学术汇编是**叙事式策展**，非可复现数据集。要自己定义总体（如"引用 Haida 的判决"）。
- **Yellowhead 禁制令研究 = 最佳可借鉴模板**（Land Back 2019 + 同行评审 "Legal Billy Club" 2023）：总体="**对 First Nations 发出的每一个禁制令**，100+ 案，全辖区"；**显式纳入/排除**（含有 standing 的、排除 FN-vs-FN、Inuit/Métis 另算）；结论 76% 准/81–82% 拒。**要避免它的弱点**：**从不命名数据源**（可复现缺口）、**日期范围自相矛盾**（1958–2019 vs 1973–2019）。
- **USask CNLR**：覆盖 Indians/Inuit/Métis 判决 1979–今，但"选录若干未报道案"的**明确规则未公布**——编辑裁量。其余（SFU/Dalhousie/BC CA/FCT 列表）几乎都是**无公布纳入标准的策展"地标"集**——可作**种子清单**，不能当总体框。

## ⚠️ 关于 A2AJ 的事实纠正（重要）
- **"~220k"是错的**：2025-09 工作论文（arXiv:2509.13032）说 **116,734 判决**；现网站说 **191,000+**。没有任何 A2AJ 来源说 220k。
- **A2AJ 明确不抓 CanLII**（论文 p.19）："许多法院/裁判所只在 CanLII 发布……我们的数据集尚不全面。" CanLII 有 300 万+，A2AJ 是其一小片。
- **联邦偏斜**：强于联邦法院 + 联邦裁判所（难民/SST/CHRT 多）；省级高等/上诉覆盖只是部分。
- **全是"非官方自动采集副本……不可避免有不准确和不完整"**。
- **[推断]** 大量原住民经济正义诉讼（资源/title/禁制令/条约）在**省级高等/上诉法院**——恰是 A2AJ 欠覆盖的层。

---

## 对 A2AJ 摄取管道的修正（落到我们的决策）

**(a) 选择 = 混合**（文献裁决，非二选一）：① PRISMA 式记录的**查询采集**当主框（但知道 Blair–Maron：召回低且会高估）② **策展种子清单**（现有地标集做种子，不当框）+ **前向滚雪球**补查询遗漏 ③ **显式声明冰山层 + A2AJ 覆盖天花板**：我们采样的是 A2AJ 联邦偏斜的 ~11.7万/19.1万，**不是**全加拿大判决宇宙（CanLII 300万+）。学 Yellowhead 的招（按 standing+主题+辖区+时窗定义、显式排除、邻近总体另算），但**改进它**：命名数据源、固定一个日期范围。

**(b) 主题标注 = 真正的取舍**：
- court "Subjects" 字段最省——但 A2AJ 无一致的丰富主题分类，多半不可用。
- 规则/关键词分类器：快、透明，但召回低 + 单议题欠编码。
- **LLM 辅助（固定 rubric + 人工验证子集 + 低温 + 多标签）是规模化最现实的最优**（Savelka–Ashley 法律 F1 0.82–0.90），**但**必须带人工验证、且 statutory/抽象类会退化（0.54）。
- 与本平台"无 LLM/抽取式"定位有张力——但**主题标签是元数据，不是展示给用户的法律论断**，LLM 标错主题远低风险于幻觉判决。这是要你/客户定的取舍。

**(c) 用金样本量纯度与标注准确率**：从**部署后语料**随机抽 **n≈384**，双人手查 on/off-topic，报 off-topic 率 + **Wilson 95% CI**；标注准确率的金集要**抽自整个总体**（才能测 recall），报每主题 P/R/F1 + **Cohen/Fleiss kappa（目标 ≥0.61，并报 prevalence/bias 避开悖论）**。一个几百条的双编码金集**一次性给选择(P/R)、纯度(Wilson)、标注(per-theme F1)三件事补上验证**，约一个标注员-周——**性价比最高的严谨投资**。

**(d) datasheet 必含**：动机+总体框（含 A2AJ 缺口/联邦偏斜/非官方副本/11.7万vs CanLII 300万）；采集流程（查询串、种子、滚雪球深度、时窗、纳入/排除、PRISMA 计数）；标注（rubric、规则/LLM/人工、提示/温度、标注员、金集 kappa 与 per-theme P/R/F1）；QC（去重法、平行引用与多级判决处理、纯度+Wilson CI）；用途/限制/分发/维护。

**只做"关键词采集+规则分类、无验证样本"的诚实代价**（四个可引用的让步）：① 召回未知且很可能低（~20%），且**无法测量**；② 纯度未测；③ 主题标签噪声、单议题、无 kappa/F1；④ A2AJ 覆盖天花板被隐含——把联邦偏斜的一片当成"加拿大原住民经济正义案例法"。缓解：那个 ~384 双编码金样本把验证一次性补回 dimensions 1–3。

## 来源（精选）
- Blair & Maron 1985 https://dl.acm.org/doi/10.1145/3166.3197 · Hellyer 2018 https://scholarship.law.wm.edu/libpubs/131/ · Hall & Wright 2008 https://papers.ssrn.com/sol3/papers.cfm?abstract_id=913336
- Priest & Klein 1984 https://chicagounbound.uchicago.edu/jls/vol13/iss1/2/ · Siegelman & Donohue 1990 https://www.jstor.org/stable/3053664 · Boyd/Kim/Schlanger 2020 https://ideas.repec.org/a/wly/empleg/v17y2020i3p466-492.html
- COLIEE https://sites.ualberta.ca/~rabelo/ · CLERC https://arxiv.org/abs/2406.17186 · CaseHOLD https://arxiv.org/abs/2104.08671 · CAP https://lil.law.harvard.edu/our-work/caselaw-access-project/ · Pile of Law https://arxiv.org/abs/2207.00220 · Wohlin 2014 https://dl.acm.org/doi/10.1145/2601248.2601268
- Landis & Koch 1977 https://doi.org/10.2307/2529310 · Feinstein & Cicchetti 1990 https://pubmed.ncbi.nlm.nih.gov/2189948/ · Shapiro "Coding Complexity" https://repository.uclawsf.edu/hastings_law_journal/vol60/iss3/1/ · Gilardi 2023 https://doi.org/10.1073/pnas.2305016120 · Savelka & Ashley 2023 https://doi.org/10.3389/frai.2023.1279794 · Ziems 2024 https://aclanthology.org/2024.cl-1.8/
- Lee 2022 (dedup) https://aclanthology.org/2022.acl-long.577/ · Cochran n≈384 / Wilson https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval · Datasheets https://arxiv.org/abs/1803.09010 · Data Statements https://aclanthology.org/Q18-1041/ · Epstein & King 2002 https://chicagounbound.uchicago.edu/uclrev/vol69/iss1/1/
- Yellowhead Land Back https://redpaper.yellowheadinstitute.org/wp-content/uploads/2019/10/red-paper-report-final.pdf · Legal Billy Club https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4370375 · USask CNLR https://indigenouslaw.usask.ca/publications/canadian-native-law-reporter.php
- A2AJ 论文（116,734；不抓 CanLII）https://arxiv.org/abs/2509.13032 · A2AJ 数据页（191k+）https://a2aj.ca/data/

## Economic supplementation (2026-07-06) — candidate methodology, pending expert (Kay) validation

To raise the thin economic dimension (`resource_revenue` was 14/~373 core), the
economic harvest surface and label rubric were broadened. **These additions are
candidate methodology awaiting expert validation; they carry no curated
authority.**

- **`THEME_QUERIES.resource_revenue`** expanded from 2 to 8 terms: `revenue sharing`,
  `resource revenue`, `impact benefit agreement`, `resource royalties`,
  `equity stake`, `equitable compensation`, `expropriation compensation`,
  `economic loss`.
- **`ECON_CANDIDATE_SEEDS`** (new, separate from curated `SEED_CITATIONS`):
  `2009 SCC 9` (Ermineskin — oil/gas royalties), `2021 SCC 28` (Southwind —
  equitable compensation for taken land), `2001 SCC 85` (Osoyoos — expropriation/
  tax), `2007 ONCA 744` (Whitefish — undervalued timber lease). Neutral citations
  verified against public court records on 2026-07-06. Not added to `enrichment.ts`;
  they pass through the inclusion filter + dual-LLM consensus gate like any
  harvested case.
- **`THEME_RUBRIC.resource_revenue`** widened (`RUBRIC_VERSION` → `2026-07-06.1`)
  to recognize impact-benefit agreements, equity participation, and compensation/
  valuation for the taking, expropriation, flooding, or infringement of land and
  resource rights. The dual-LLM consensus gate is unchanged, so the wider rubric
  only proposes more matches — both models must still agree.
- **No dollar figures were fabricated.** Monetary `EconomicDimension` values remain
  curated-only; figure estimation is deferred to client idea #3.

## Recorded economic figures (2026-07-07) — extracted, citation-anchored, non-authoritative

Client idea #3 ("economic impact estimator") is implemented as **recorded economic
figures**, deliberately NOT an estimate or projection. An LLM extracts monetary
figures from core judgments; a mechanical verifier keeps a figure only if its
amount parses deterministically AND its quote appears verbatim in the judgment
text (re-anchored, same discipline as the AI summaries). Every displayed figure is
the court's own number, citation-anchored to a paragraph.

- **Storage:** a non-authoritative `extractedFigures[]` layer on each case,
  separate from the curated (Kay-authoritative) `economic` field.
- **Aggregation:** per-kind ranges (min/median/max) over court-`awarded`/`ordered`
  figures, one amount per case per kind, with a coverage denominator (`N / core`).
  **No cross-case or cross-kind totals** — a summed "economic value of Indigenous
  wins" would be the Gallagher credibility trap (non-representative, non-commensurable).
- **Caveats surfaced in the UI:** nominal amounts across different years (not
  inflation-adjusted); figures are AI-extracted and should be verified against the
  source; the curated `economic` field remains the authoritative record.
