# Indigenomics Research Agent — Agentic 产品设计文档

> 用 agentic-product-design 向导生成。日期：2026-06-24
> 配套文档：[MVP 落地设计（类型契约 / AWS 架构 / 试跑清单）](./2026-06-24-research-agent-mvp-design.md)（本文引用其 §3 契约、§4 架构、§6 试跑，不重复粘贴）
> 数据来源：`docs/Indigenomics_Data_Portal_Research_v1.xlsx`

## 0. 产品一句话

- **是什么**：把 Indigenomics 数据门户的"第二层聚合指标"从手工编制升级为半自动——从公开文档采集原住民经济指标、抽取、经人工确认后并入 Index。
- **核心任务**：给定一个实体(公司/部门/机构) × 一个来源(ESG/RAP/联邦CSV/ESTMA/CER/NACCA)，自主完成 `抓取 → 解析 → 抽取 → 绑定溯源 → 标置信/冲突 → 落 pending`，等人确认。
- **目标用户**：Indigenomics 研究/运营人员（确认闸的审核者）；间接服务看 Index 的公司/供应商/公众。
- **领域类型**：研报/数据抽取型 agent（只读外部 + 写本地 + 人在环）。

## 0.5 Agent 画像与重排（决定后面的顺序与扣分）

- **动作面**：只读外部 + 写本地（不执行 shell、不对外发布/付款）→ **风险系数 ×1.1**。但**吃外部不可信内容**(ESG/RAP PDF、网页)，真实威胁面 ≠ 删库。
- **范式**：任务完成型(跑批) + **建议型**(提议数值待人确认)　**价值来源**：**输出质量**(抽取准确性/grounding)　**利害合规**：PII 低(公开源)、但**政治/声誉高敏**、基本可逆(可改值)
- **自治模型**：**混合/约束式**——LLM 只负责抽取并吐结构化值，确定性管线 + 人工确认闸决定"什么能发布"。→ ①④ 按"自治边界/确认闸"重判，不套"自主循环"裸尺。
- **重排后层序 + 理由**：**② ③ ④ ⑤ ＋输出质量eval ① ⑥ ⑦ ⑨ ⑧**。理由：输出质量驱动 → ② 上下文/grounding 升 T0 顶、激活「输出质量 eval」置 T1；吃外部不可信内容 → ④ 留 T1 但威胁面重定向为注入/SSRF；约束式 → ① 降为"边界设计"判据；⑧ 多 agent 是 T3，**本设计有意推迟到 H2**。
- **激活的附加维度**：**输出质量 eval**(T1，命脉)；**隐私合规**(T2，轻量——公开源 PII 低，但需保留审计/溯源/更正流程)。
- **本 agent 的真实威胁面**：① **提示注入**(抓回的 ESG/RAP PDF 内藏指令劫持抽取)；② **SSRF**(乱抓文档内链接)；③ **幻觉/张冠李戴的数字**(把 A 公司的采购额安到 B 公司，在和解议题上≈诽谤)。免疫清单对着这三条列，不是 `rm -rf`。

## 评分总览（按重排后顺序）

> 风险调整分 = 10 − (10−裸分)×1.1，只作用于安全相关层 ③④⑤（封顶 0）。评的是**当前设计成熟度**（MVP 设计稿），非已上线系统。

| 层/维度 | 价值位 | 裸分 | 风险调整分 | 最大缺口 |
|---|---|---|---|---|
| ② 上下文工程与记忆 | T0 顶 | 7 | 7 | 片段检索库 + 承诺跨版本记忆整合 |
| ③ 工具/能力契约 | T0 | 6 | 5.6 | 抓取/解析/抽取工具的逐工具契约 + 成本上限 |
| ④ 权限与护栏 | T1 | 7 | 6.7 | 确定性注入隔离 hook + 人工前的分类器分级 |
| ⑤ 信任与可观测 | T1 | 6 | 5.6 | 审核者并排看 snippet 的 UI + run 级遥测 + 可恢复 |
| ＋ 输出质量 eval | T1 | 5 | 5 | 标注 gold 集 + 在线 grounding 回归监控 |
| ① Agent Loop 与控制权 | T0(重判) | 6 | 6 | 单次 run 预算/步数熔断 + fallback 解析路径 |
| ⑥ 交互入口 | T2 | 5 | 5 | admin "跑一次/看队列" 入口可发现化 |
| ⑦ 扩展性 | T2 | 5 | 5 | "加一个来源适配器" 的标准配方 |
| ⑨ 运维与度量 | T3 | 3 | 3 | 单次抽取成本模型 + 灰度 + 质量漂移报警 |
| ⑧ 多 agent 编排 | T3 | 5（有意推迟） | 5 | 来源专职 agent + 协调者(H2，开关后放量) |
| ＋ 隐私合规 | T2(轻) | 6 | 6 | 缓存 PDF 留存策略 + 确认动作审计日志 + 更正/下架流程 |
| | **均分(T0+T1)≈6.2 ｜ 最弱：⑨ 运维(3)、输出质量eval(5)** | | | |

---

## ① Agent Loop 与控制权（T0，按约束式重判）

- **决策**：自治边界由**确定性结构锁死**——LLM 不进开放循环，只在 Step Functions 编排的单步里吐结构化值；输出必须引用 snippet 才被接受；发布须过人工闸。这是原则 #7「确定性护栏包裹模型」推到极致 → 边界设计本身高分。
- **评分**：6 — **到 10 还差**：单次 run 的 **token/美元预算熔断**、**步数上限**(每文档抽取调用次数)、主解析失败的 **fallback 路径**(Textract 失败 → Docling)、部分/失败/模糊结果的显式处理。
- **配置**：`maxExtractCallsPerDoc`(简单文档 3–5、复杂 RAP 10–25) + `maxBudgetUsdPerRun` 熔断 + 解析器 fallback 链 + 中断语义：抽取中途 `cancel`(丢半成品)、写 DynamoDB `block`。

## ② 上下文工程与记忆（T0 顶——本 agent 命脉）

- **决策**：**指标字典即 taxonomy**——每个 `MetricDef.methodology` 注入抽取 prompt（研究证实 taxonomy 锚定抽取 ≫ 裸 PDF，准确率从 <30% 抬到 >70%）。每个值/承诺强制带 `Provenance{snippet,page,bbox}`。RAP 承诺用 `timeline[]` 做跨版本纵向记忆。
- **评分**：7 — **到 10 还差**：① 抽取用的**片段检索库**(把长 PDF 切块、按指标术语检索相关段，而非整篇喂模型)；② **承诺跨版本整合/冲突消解**(第 N 年"committed" → 第 N+2 年"achieved" 要合并成一条 timeline，不是两条孤值)；③ prompt 稳定性服务缓存命中(降成本)。
- **配置**：system/extraction prompt 分块＝[抽取角色与禁区 / 目标 MetricDef 定义+单位+方法论 / 文档元信息 / 输出 schema / "指不出 snippet 就返回 null"]；切块阈值 + 按指标族检索 top-k 段；承诺整合键＝`entityId + 归一化承诺文本`。

## ③ 工具/能力契约（T0）

- **决策**：`researchRepo` seam 已定义（见 MVP §3），fail-closed——`putExtractedValue` 拒收无 `snippet` 或 snippet 不含该值的写入。机读源走确定性工具、不过 LLM。沿用现有 `repo`/`surveyRepo` 契约优先、mock/dynamo 可换的成熟范式。
- **评分**：6（风险调整 5.6）— **到 10 还差**：`fetch`/`parsePdf`/`extract` 三个工具的**逐工具契约**(input schema、`isReadOnly`、`isDestructive=false`、`maxResultSize` 成本截断、给模型的描述文案)尚未写定；解析大 PDF 的输出截断策略。
- **配置**：工具契约字段表 = name / inputSchema / 描述(写给模型，含失败模式) / isReadOnly / maxResultSizeChars(超限存 S3 只回预览) / userFacingName；fail-closed 默认 isReadOnly=false、isConcurrencySafe=false。

## ④ 权限与护栏（T1，威胁面=注入/SSRF/幻觉）

- **决策**：三道护栏（MVP §5）——(1) **provenance-or-reject**；(2) **抓取 URL 白名单**(只下 suncor.com/enbridge.com/telus.com/open.canada.ca/nrcan.gc.ca/nacca.ca… 防 SSRF，不跟文档内任意链接)；(3) **置信度闸**(conf<τ / 有 conflict / value=null 一律 pending)。抓回内容当**数据**不当指令(结构化输出 + 必须引用 snippet 同时中和注入)。
- **评分**：7（风险调整 6.7）— **到 10 还差**：① 模型动手前后的**确定性 hook**(PreExtract：剥离/隔离不可信文本里的祈使句；PostExtract：脱敏+校验)；② **机器先行分级**——人工前加一个便宜分类器(判"这页有无该指标")过滤，别让审核者淹没在 pending 里；③ 抓取速率/范围限额。
- **配置**：免疫清单(任何模式强制人工)＝[把某值标记 confirmed 发布到公开 Index]；规则三态 allow/deny/ask 以 `metricFamily × sourceKind` 为范围；连续抽取失败 N 次自动降级为"标 pending 待人"而非反复重试。

## ⑤ 信任与可观测（T1）

- **决策**：确认闸＝人在环 + 审计轨迹(`provenance` + `reviewedBy/At` + 状态机)。复用 `/verify` 队列 UX。状态 `pending→confirmed|disputed|corrected|rejected` 全程可回溯；`withdrawn` 软删除(OCAP 风格)。
- **评分**：6（风险调整 5.6）— **到 10 还差**：① **审核者 UI**——并排展示 `snippet + 原文页(bbox 高亮) + confidence + conflictWith`，让人 3 秒能判(现在只设计了数据，没设计审核视图)；② **run 级可观测**(本次跑了哪些文档/几条成功/几条失败/卡在哪)；③ 跑批**可恢复**(Step Functions 中断后续上)。
- **配置**：透明度清单 = 当前处理文档 + 已抽条数 + 失败原因；plan/act＝整批跑前先列"将抓取的 N 个文档清单"供 admin 批准；验证回路＝snippet 必含值(输出验证) + ≥80% 精度抽样人审。

## ＋ 输出质量 eval（激活·T1·命脉）

- **决策**：xlsx 的"数据说明/方法论备注"列＝人写的 caveat 种子；试跑(MVP §6)定了验收门槛(provenance 全覆盖、≥80% 精度、承诺状态正确、抗注入)。
- **评分**：5 — **到 10 还差**：① **标注 gold 集**(把现有 xlsx 的已知值 + 3 份试跑 RAP 手工核对值固化成回归集)；② **在线 grounding/事实核查**(抽出值能否在原文定位)；③ **上线后质量回归监控**——每次换模型/改 prompt 都跑 gold 集，防准确率悄悄腐烂(政治高敏域的头号风险)；④ 抽样人审闭环。
- **配置**：gold 集 = {entityId, metricId, period, 期望值, 期望 snippet}；CI 门槛：精度跌破阈值阻断 prompt/模型变更上线。

## ① 之后的放大层

### ⑥ 交互入口（T2）
- **决策**：admin "跑一次/看 pending 队列" 入口；机读源不走 LLM(三类执行分流正确——省钱秒回)。
- **评分**：5 — **到 10 还差**：入口可发现化(Indigenomics 首页加"研究采集"卡片)、确定性"重算 Index"本地直返。
- **配置**：命令＝`研究采集(走编排)` / `看确认队列(本地查 GSI1 STATUS#pending)` / `导出某实体所有溯源(本地)`。

### ⑦ 扩展性（T2）
- **决策**：新增来源＝加一个 `SourceKind` + 对应 extractor，是干净的扩展轴；指标字典可作为配置演进。
- **评分**：5 — **到 10 还差**："加一个来源适配器" 的标准配方(fetch+parse+map 三件套接口)、指标字典做成可由研究员编辑的配置而非硬编码。
- **配置**：source adapter 契约 = {kind, 允许域, fetch(), parse(), mapToMetrics()}；新增不改核心。

### ⑨ 运维与度量（T3——当前最弱）
- **决策**：采集频率(年度/按交易)已定；按 `sha256` 去重防重复抽取。
- **评分**：3 — **到 10 还差**：① **单次抽取成本模型**(每文档 token/解析页数/模型调用 → 看板，AI 数据产品最容易"用越多亏越多")；② **灰度**(feature flag 包裹新 source/新 prompt，5%→全量，秒级可关)；③ **抽取质量漂移报警**；④ 企业管控(配额/审计)。
- **配置**：成本核算项＝输入/输出 token + 解析页数 + 重试次数；灰度＝按 sourceKind 开关；漂移＝gold 集精度周环比报警。

### ⑧ 多 agent 编排（T3——有意推迟到 H2）
- **决策**：**MVP 不上多 agent**(它是护城河层、最不成熟)。Step Functions 的 per-source fan-out + per-extractor 分解，正是 H2 升级为来源专职 agent 的**接缝**；所有子 agent 都过同一确认闸 → 天然继承护栏。
- **评分**：5（"有意推迟"是优点不是缺口）— **到 10 还差**(H2)：来源专职 agent(ESG专家/RAP专家/财务专家) + 协调者汇总 + **feature 开关后渐进放量** + 每个子 agent 继承单 run 预算熔断。
- **配置**：决策清单结论＝"单 agent + 好工具(确定性 fetcher)已够 MVP，**不为炫技上多 agent**"；H2 协调模式＝角色分工 + 协调者。

### ＋ 隐私合规（激活·T2·轻量）
- **决策**：公开源 → PII 低；`provenance` + 审计轨迹已设计；研究实体非 OCAP 供应商，独立 `entityId` 命名空间。
- **评分**：6 — **到 10 还差**：缓存 PDF 的**留存/删除策略**、确认动作的审计日志、错误数据的**更正/下架流程**(高敏域必须有"我们更正了 X"的可追溯路径)。
- **配置**：S3 原件留存期 + 更正＝`corrected` 状态保留旧值溯源、不硬删。

---

## 可落地配置汇总

```
# Loop 刹车（①）
maxExtractCallsPerDoc = 3–5 (ESG) / 10–25 (RAP)
maxBudgetUsdPerRun    = <设上限，超则熔断+报告>
parserFallback        = [Textract → Docling]
interrupt             = extract:cancel / dynamoWrite:block

# 上下文（②）
promptBlocks = [角色禁区, 目标MetricDef+方法论, 文档元信息, 输出schema, "无snippet则null"]
chunking     = 切块+按指标族检索 top-k
commitmentKey= entityId + 归一化承诺文本（跨版本合并）

# 工具契约（③） fail-closed
defaults = {isReadOnly:false, isConcurrencySafe:false, isDestructive:false}
maxResultSizeChars = 超限存S3只回预览

# 护栏（④） 免疫清单
immune       = [发布值到公开Index → 强制人工]
fetchAllowlist = [suncor/enbridge/telus/open.canada/nrcan/nacca/...]
gate         = conf<τ || conflict || value==null → pending
hooks        = PreExtract(隔离不可信祈使句) / PostExtract(校验+脱敏)

# 信任（⑤）
reviewerUI   = snippet + 页bbox高亮 + confidence + conflictWith 并排
plan/act     = 整批跑前列文档清单待admin批准
verify       = snippet必含值 + ≥80%精度抽样

# 输出质量 eval
gold = {entityId, metricId, period, 期望值, 期望snippet}  # 来自xlsx+3份试跑
ci   = 精度<阈值 → 阻断模型/prompt变更

# 运维（⑨）
cost   = token + 解析页数 + 重试  → 看板
rollout= feature flag per sourceKind, 5%→全量, 秒级关
drift  = gold精度周环比报警
```

## Top 3 必补项（按 价值位 × 风险调整缺口 排序）

1. **输出质量 eval（T1，缺口最大且后果最重）**：没有常驻 gold 集 + 在线 grounding 回归，抽取精度会随模型/prompt 变更**悄悄腐烂**；在原住民和解这种政治高敏域，错一个数字＝信誉事故。**动作**：用现有 xlsx 已知值 + 3 份试跑 RAP 固化标注集，把"精度<阈值阻断上线"做进 CI。
2. **⑤ 审核者 UI + ④ 注入隔离 hook（T1，安全命脉）**：确认闸的价值上限＝审核者能看到什么。**动作**：先做并排 `snippet+页高亮+confidence+conflict` 审核视图；再加 PreExtract 确定性 hook 隔离抓回内容里的祈使句，杜绝注入劫持。
3. **② 承诺纵向记忆 + 片段检索库（T0，novel 价值最难）**：RAP 的承诺-状态-时间线是本功能最独特也最易碎的部分。**动作**：建切块检索库(别整篇喂模型) + 跨 RAP 版本的承诺整合/冲突消解键，否则 timeline 会碎成一堆孤值。

## 横切原则自检

| 原则 | 是否落地 | 说明 |
|---|---|---|
| fail-closed 默认 | ✅ | 无 snippet 不入库；conf 低/冲突/未披露 → pending；默认不发布 |
| 拦截在前放行在后 | ✅ | 一切先落 pending，仅显式 confirm 才进公开 Index |
| 不可逆操作设免疫层 | ⚠️ 部分 | "发布到公开 Index" 已设为人工免疫闸；更正/下架流程待补(隐私合规) |
| 机器先行人工兜底 | ⚠️ 部分 | 确定性 fetcher + 置信闸先过滤；缺人工前的便宜分类器分级 |
| 透明可观测+可刹车 | ⚠️ 缺口 | 确认轨迹可审计，但 run 级遥测 + 可恢复跑批未设计 |
| 成本即毛利 | ⚠️ 缺口 | 机读源正确绕开 LLM(好)，但无单次抽取成本核算 |
| 确定性护栏包裹模型 | ✅ 强 | 确定性管线夹住 LLM；结构化输出 + 必须引用 snippet；稠密表走确定性抽取 |
| 拒绝/卡住都有出口 | ⚠️ 部分 | 低置信→人工队列是出口；缺连续失败的自动降级 |
| 先验证再声称完成 | ✅ | grounding(snippet 必含值)＝输出验证；≥80% 精度验收 |

## 路线图（价值顺序＝实施顺序）

- **MVP（先做）**：锁 `researchRepo` seam → mock 实现(页面零基础设施可开发) → 确定性 fetcher(联邦/ESTMA/CER) → **1 个**抽取 Lambda(ESG/RAP/NACCA，Textract 起步) → 三道护栏 → 扩展 `/verify` 审核视图 → 3 份 RAP 试跑(Enbridge/TELUS/Agnico)。
- **补命脉(紧接 MVP)**：Top-3 必补——gold eval 集 + 审核者 UI + 承诺纵向记忆。
- **H2(护城河)**：来源专职多 agent(开关后放量) + 成本看板/灰度/漂移报警 + 公开 per-entity 研究页 + 定时全量跑批。

---

## 附：评分卡速读

```
（按裸分，每块=1分；重排后顺序，越靠上越该先补满）
② 上下文/记忆      ▓▓▓▓▓▓▓░░░  7
③ 工具契约         ▓▓▓▓▓▓░░░░  6
④ 权限/护栏        ▓▓▓▓▓▓▓░░░  7
⑤ 信任/可观测      ▓▓▓▓▓▓░░░░  6
＋输出质量 eval     ▓▓▓▓▓░░░░░  5  ← T1 命脉，最该先补
① Loop(约束式)     ▓▓▓▓▓▓░░░░  6
⑥ 交互入口         ▓▓▓▓▓░░░░░  5
⑦ 扩展性           ▓▓▓▓▓░░░░░  5
⑨ 运维/度量        ▓▓▓░░░░░░░  3  ← 最弱
⑧ 多 agent(推迟)   ▓▓▓▓▓░░░░░  5
＋隐私合规(轻)      ▓▓▓▓▓▓░░░░  6
```

**结论**：T0+T1 均分 ≈6.2，对一份设计稿是健康的起点。能不能"放手用"取决于把 **输出质量 eval(5)** 和 **⑤ 审核者透明度(6)** 逼到 8+——这两条决定审核者敢不敢信、错误会不会被早期拦住。**⑨ 运维(3)** 是上线前必补的成本/灰度底座。多 agent(⑧) 的"有意推迟"是正确取舍，不是缺口。
