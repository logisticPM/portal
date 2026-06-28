# 法律文本检索 (Legal Text Search) 前沿做法与可参考案例

> 研究日期：2026-06-25。面向"加拿大原住民法案例库（几百~几千篇判决）+ DynamoDB 正本 + 可换 repo 接缝"的可落地视角。
> 标注：**[实证]**=同行评审/arXiv 有实测数字；**[厂商]**=厂商文档/营销；**[报道]**=媒体；**[推断]**=我方推理。

---

## 1. 收敛的范式（业界+学界共识的"配方"）

**核心母题：法律检索里，纯向量/神经组件单用会败给 BM25**——因为法律查询充满精确 token（案名、中性引用 `2014 SCC 44`、法条号、判例名 *Tsilhqot'in*、"duty to consult"、Nation 名），单个向量是"低通滤波器"会丢掉这些稀有词。

**配方（逐层叠加）：**
1. **混合检索 = BM25 + 稠密向量**（地板，不是纯向量）。[实证] BEIR：BM25 零样本击败稠密检索 11/18；EntityQuestions：实体型查询 BM25 71% vs DPR 51%；COLIEE 2021 纯 BM25 拿过第 2。
2. **RRF 融合**（Reciprocal Rank Fusion，k=60，Cormack 2009）。[实证] 跨异构检索器无需归一化分数，是默认融合法。
3. **检索→重排（retrieve-then-rerank）——但小心长判决**。[实证] CLERC 上用通用 cross-encoder 重排整篇判决反而把 R@10 从 8.4%→4–5%。教训：**重排"段落级"单元，别重排整篇**；用领域匹配/托管的法律 reranker（Cohere Rerank 3.5 / 开源 bge-reranker-v2-m3 / monoT5）。
4. **结构感知分块 + 元数据过滤**。[实证] 段落/结构保留分块优于定长切片；"摘要增强分块"（每块前置 ~150 字文档摘要）可把"取错文档"问题减半。每块挂：法院、年份、中性引用、辖区、法官、被引案例。
5. **引用锚定生成（quote-grounding）**——最关键的防幻觉手段。[实证] CLERC：把源段落喂给模型，GPT-4o 引用假阳性率从 **71.5% → 6.4%**。只允许从检索到的段落作答、每条主张标注源段落号。
6. **引用网络/知识图谱增强**（若案例间互相引用）。[实证] HITS 权威分能复现专家"地标案例"判断；文本+引用结构融合比单用任一好（Hier-SPCNet +11.8%/+20.6%）。Lexis+ AI 的 GraphRAG 和 TR/Lexis 的"citator 当检索工具"正是这条。

**一句话配方**：Hybrid(BM25+dense) → RRF → 段落级重排（领域匹配）→ 结构化段落块+元数据过滤 → 引用锚定生成（标段落号）→（有引用边则）按引用图权威度加权。

---

## 2. 最该参考的基准：COLIEE（就是加拿大的！）

- **COLIEE Task 1/2 建立在加拿大联邦法院（Federal Court of Canada）判例上**（主文档确认是联邦法院，非"最高法院"——很多二手资料写错）。这是我们最近的公开校准目标。
- 现状：case retrieval F1 仅 0.3–0.45——**法律案例检索本身就很难**（且 COLIEE 抑制了真实引用）。
- **冠军系统一致是"混合 BM25 + 神经重排 + LLM"流水线**。
- 自评检索步骤可用 **LegalBench-RAG** 的方法论。

---

## 3. 生产级参考系统 & 该借鉴什么

| 系统 | 已知/报道的检索做法 | 借鉴点 | 可信度 |
|---|---|---|---|
| **Lexis+ AI** | **GraphRAG = RAG + Shepard's 引用图**；多模型（Bedrock 上的 Claude/GPT-4o/微调 Mistral） | 引用图(citator)显式融入检索 + 引用校验 | 确认/营销 |
| **TR CoCounsel / Westlaw AIAR** | Westlaw AIAR=RAG；CoCounsel Deep Research=**agentic 多步**；**KeyCite citator 作为工具**标记被推翻案例 | citator 当检索工具；agentic 多步检索；内联引用+处理状态标记 | 确认(TR 博客) |
| **Harvey** | **Agentic search (ReAct)** over RAG（LanceDB IVF-PQ + pgvector/HNSW）；明说关键词漏义、稠密在稀有案号上吃力→所以要混合 | 混合检索理由说得很直白；元数据+时效+LLM 相关性推理；**pgvector 在其规模可行** | 确认(工程博客) |
| **vLex Vincent AI** | RAG + 解耦检索（"先找权威，再只从已验证源作答"）；模型无关路由 | 严格锚定到检索权威；**唯一有独立 RCT 验证**（幻觉≈无 AI 基线） | 确认(锚定)/营销(3.67×) |
| **Alexi（加拿大）** | 自称"首个法律备忘录 RAG"→"agentic RAG"；20M+ 加/美 Q&A 对 | 加拿大辖区覆盖模型；agentic 备忘录生成 | 营销/报道 |

**趋势（2024→2026）**：从一次性 RAG 走向 **agentic 多步检索**，且 **citator（KeyCite/Shepard's）成为一等检索/锚定工具**——这是法律 RAG 区别于通用企业 RAG 的最显著特征。

**开源/可复制工具（我们在 AWS）**：
- ⭐ **Amazon OpenSearch Service** — 原生 `hybrid`(BM25+k-NN) + 内置 RRF(2.19) + `rerank` 处理器调 Bedrock 上 Cohere Rerank。AWS 原生最契合。
- **Postgres pgvector (+ ParadeDB pg_search 做真 BM25)** — RRF 用 SQL，精确(flat)向量检索，运维最省。
- Elasticsearch ELSER（学习型稀疏）/ Vespa / Weaviate 均支持 hybrid+RRF。
- 参考：AWS "Bedrock + OpenSearch hybrid RAG" 博客；CLERC repo；LegalBench repo。

---

## 4. 加拿大数据现实（重要法务红线）

| 资源 | 给你什么 | 关键约束 |
|---|---|---|
| ⭐ **A2AJ / Canadian Legal Data** (arXiv:2509.13032) | **CanLII 的开放替代**。无密钥全文 API（`/search` 布尔/短语/通配/邻近、`/fetch` 按引用、`/coverage`）；**自带 MCP server (`mcp.a2aj.ca`)** 可直接做 RAG 锚定；HF ML 数据集。现 ~22.3 万判决/~1.09 万法规（含 SCC/FCA/FC/税务法院）。MIT 代码，逐文档 `upstream_license`。 | 用前核对每篇原住民法案例的 `upstream_license` |
| **CanLII** | 240 万+ 文档、全辖区；"Note up" citator；CanLII Connects 社区摘要 | **API 只返回 JSON 元数据、非全文**，需审批密钥；**条款禁止批量/程序化下载**（已起诉 Caseway AI，2024-11，已和解） |

**[推断]** 要把全文存进自家 DB（DynamoDB），**A2AJ 是实务上的开放底座**；CanLII 条款会挡住批量摄取。

---

## 5. 对我们这个小语料的含义（落地建议）

1. **暂时别上专用 ANN 向量库**。[实证] 几百~几千篇（切段落约几万块）→ **精确暴力检索就是对的**：满召回、零调参、亚毫秒~几毫秒。FAISS `IndexFlat`、pgvector 默认都是精确；ANN(HNSW/IVF) 要到 ~50万–100万向量才划算。可换 repo 接缝正是对冲：DynamoDB 当正本，检索索引藏在接缝后。
2. **第一天就按混合检索设计，别纯向量**。原住民法检索高度依赖精确词（案名、`2014 SCC 44`、法条、*Van der Peet*、Nation 名）。BM25+dense，RRF(k=60) 融合。
3. **两条务实路径（都在接缝后）**：① pgvector+tsvector/ParadeDB（运维最省）；② **Amazon OpenSearch**（AWS 原生 hybrid+RRF+rerank 调 Bedrock，语料涨了也能扩）。生成用 **Bedrock 上 Claude**；**A2AJ MCP server** 是现成的锚定连接器范式可研究。
4. **Embedding 用强力通用模型起步**：OpenAI `text-embedding-3-large` / `voyage-3-large` / 自托管 `bge-m3`（一模型出 dense+sparse）。**别拿 LegalBERT 系当检索器**（它们是 MLM、不是相似度，CLERC 上≤BM25）。[实证] LegalBench-RAG 证明：**分块+重排（仅用通用 OpenAI embedding）才是决定性杠杆**；小语料没标注对，先别微调。
5. **段落级分块（已计划）并加以利用**：段落号天然是"小到大检索"单元，也是**引用锚定的溯源锚点**。
6. **若案例互相引用，构建引用图**：抽 cases-cite-cases 边、算权威分，突出地标案例（Calder/Sparrow/Delgamuukw/Haida/Tsilhqot'in）——这既是 +11–20% 的相似度收益，也是**相对通用搜索的差异化**。
7. **从一开始就控幻觉**（这里风险最高）：引用锚定生成、内联源文本（CLERC 71%→6%）、人在环；[实证] 即便最好的商业工具也错 ~1/5（Stanford：Lexis+ AI 17%、Westlaw AIAR 33% 幻觉），**绝不宣称"零幻觉"**。

---

## 来源（精选）
- BEIR https://arxiv.org/abs/2104.08663 · EntityQuestions https://aclanthology.org/2021.emnlp-main.496/ · RRF(Cormack 2009) https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf
- CLERC https://arxiv.org/abs/2406.17186 (v2 锚定 71%→6% https://arxiv.org/html/2406.17186v2) · COLIEE 2024 overview https://coliee.org/documents/waivers/overview_COLIEE2024.pdf · NeuralMind COLIEE(加拿大联邦法院) https://github.com/neuralmind-ai/coliee
- 法律分块 https://ebooks.iospress.nl/doi/10.3233/FAIA241255 · 摘要增强分块 https://arxiv.org/html/2510.06999v1 · LegalBench-RAG https://arxiv.org/abs/2408.10343
- 引用网络 Fowler&Jeon https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1008032 · Hier-SPCNet https://arxiv.org/abs/2209.12474 · CaseLink https://arxiv.org/html/2403.17780v1
- ColBERTv2 https://arxiv.org/abs/2112.01488 · bge-reranker-v2-m3 https://huggingface.co/BAAI/bge-reranker-v2-m3 · Cohere Rerank 3.5 https://docs.cohere.com/changelog/rerank-v3.5
- 幻觉 Magesh et al. https://arxiv.org/abs/2405.20362 · Large Legal Fictions https://arxiv.org/abs/2401.01301
- 嵌入：text-embedding-3 https://openai.com/index/new-embedding-models-and-api-updates/ · BGE-M3 https://arxiv.org/abs/2402.03216 · voyage-3-large https://blog.voyageai.com/2025/01/07/voyage-3-large/ · MLEB https://arxiv.org/abs/2510.19365
- 系统：Lexis+ GraphRAG https://www.deweybstrategic.com/2024/07/lexisnexis-enhances-lexis-ai-with-new-features-ai-models-and-graphing.html · TR Deep Research https://medium.com/tr-labs-ml-engineering-blog/deep-research-in-westlaw-and-cocounsel-building-agents-that-research-like-lawyers-508ad5c70e45 · Harvey agentic https://www.harvey.ai/blog/how-agentic-search-unlocks-legal-research-intelligence · vLex RCT https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5162111
- OpenSearch hybrid https://docs.opensearch.org/latest/vector-search/ai-search/hybrid-search/index/ · ParadeDB hybrid https://www.paradedb.com/blog/hybrid-search-in-postgresql-the-missing-manual · AWS Bedrock+OpenSearch RAG https://aws.amazon.com/blogs/machine-learning/building-intelligent-search-with-amazon-bedrock-and-amazon-opensearch-for-hybrid-rag-solutions/
- A2AJ https://arxiv.org/abs/2509.13032 · API https://api.a2aj.ca/docs · GitHub https://github.com/a2aj-ca/canadian-legal-data · CanLII v Caseway https://www.cbc.ca/news/canada/british-columbia/canlii-lawsuit-caseway-ai-1.7374964
