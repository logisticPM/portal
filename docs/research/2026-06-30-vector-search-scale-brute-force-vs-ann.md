# 向量检索基建：暴力 vs ANN，混合架构 —— 规模决策（带来源）

> 研究日期：2026-06-30。决策：给法律案例语料加语义/混合检索。规模：~1300 全文判决（增向几千），细分块后约几万 passage。栈=DynamoDB+SST。A=向量存 DynamoDB 属性+进程内暴力余弦；B=Amazon OpenSearch(BM25+HNSW+RRF)；C=Postgres+pgvector。
> 证据标注：[PEER]=同行评审；[MAINT]=工具维护者文档（经验法则，非论文）；[VENDOR]=厂商/博客基准；[INFER]=推断。

## 1. 暴力(Flat) vs ANN(HNSW/IVF) —— 规模拐点
**核心权衡**：暴力=满召回+零调参+O(N) 延迟；ANN=亚线性延迟+召回损失+索引构建/内存/调参成本。ANN 是为"大 N 延迟"问题存在的——我们还没有这个问题。
- [MAINT] **FAISS "选索引指南"**：要精确结果就用 `IndexFlat`；"数据集小或 RAM 多 → HNSW 最佳"；IVF 的配方按 **1M–1B** 向量分级。即 FAISS 把"小数据集"和"精确够用"视为同一档，ANN 配方以**百万到十亿**计，不是几万。([FAISS wiki](https://github.com/facebookresearch/faiss/wiki/Guidelines-to-choose-an-index))
- [MAINT] **pgvector README**：默认精确最近邻、**满召回**；加 HNSW/IVF "用召回换速度…加近似索引后查询结果会变"；且"**表小时，全表扫描可能更快**"——小行数下加索引是纯下风（构建+内存+召回损失，无延迟收益）。([pgvector](https://github.com/pgvector/pgvector))
- [VENDOR] 暴力余弦延迟（量级）：~10k ≈ 几 ms；**~100k ≈ 个位到几十 ms（舒适 sub-100ms）**；~500k ≈ 几百 ms；~1M ≈ 几百 ms–1–2s（ANN 开始划算）。机制：L2 归一化后余弦=点积=一次矩阵乘，BLAS 极快。
- **premature ANN 的代价**：召回不再=1.0（ann-benchmarks 把问题定义为 **recall-vs-QPS 帕累托曲线**，[PEER] Aumüller et al. *Information Systems* 2020 [arXiv:1807.05614]；HNSW [PEER] Malkov & Yashunin TPAMI 2018 [arXiv:1603.09320] 靠 ef/M 调参且吃内存）。对法律语料，漏掉对点判例是实质失败，不是外观问题。
- **结论(1)**：几万向量，比任何维护者/基准说的"需要 ANN"的点低 1–2 个数量级。即便将来 10万–20万 chunk，暴力仍交互级。

## 2. 混合检索 —— 既定配方？是
- [PEER] **RRF**（Cormack et al. SIGIR 2009）：`score=Σ 1/(k+rank)`，**k=60**；融合不可比分数(BM25 vs 余弦)、零调参、击败 Condorcet/L2R。生产引擎(Elastic 等)默认 k=60 沿用。
- [PEER] **BEIR**（Thakur et al. NeurIPS 2021 [arXiv:2104.08663]）：**BM25 是极稳健的零样本基线，稠密检索域外不一定胜过它**——这是"保留词法检索"的实证基础。
- 法律尤甚：法条号/中性引用/案号/当事方/术语都是稠密嵌入会"糊掉"的精确 token，词法匹配才保证查得到。[PEER] **LegalBench-RAG** [arXiv:2408.10343] 确立法律 RAG 的瓶颈在检索精度 → 支持混合。
- **重排**（cross-encoder，[PEER] Nogueira & Cho 2019）：能提精度，但**我们这规模对召回非必需**，是可延后的排序润色。
- **结论(2)**：BM25 + 稠密 + RRF(k=60) 是有同行评审支撑的既定配方，法律比通用更需要它。重排可延后。

## 3. Embedding 选型（小语料，简）
- [PEER] BEIR 的零样本结论 + 混合架构 → **强力通用嵌入器在小规模"够用"，混合检索替代了领域微调**。MTEB（[arXiv:2210.07316]）是对比基准面。
- 选 **1024-d 通用模型**（bge-m3 开源 / voyage-3）起步；法律专用（voyage-law-2）等有标注 eval 显示差距再上。
- 维度事实：1024-d float32 = **4096 字节**/向量（喂给 §4）。
- **结论(3)**：现在选一个强力通用 1024-d 嵌入器，靠混合覆盖精确词查询。

## 4. 映射 A/B/C（我们的规模）—— 推荐 **A**
**推荐：A（向量存 DynamoDB Binary 属性 + 进程内暴力余弦）现在做，B/C 等触发器。**
- 正是 FAISS/pgvector 都称"小→精确/扫描"的档；sub-100ms、**满召回零调参**（法律最该要的特性）；不出现有 DynamoDB+SST 栈。
- **内存**：5万×1024-d float32 ≈ **205MB**；10万 ≈ 410MB；Lambda 上限 10GB → 整个向量矩阵装得下。
- **必须处理的坑**：①单向量 ~4KB « 400KB item 限，一向量一 item 没问题；②**别用 List-of-Number 存向量**（DynamoDB Number 是变长十进制，1024 元素会涨到几十 KB）→ **存 Binary（打包 float32 字节）**；③**别每次查询都 Scan 全部向量**（1 RCU=4KB；5万 item≈5万 RCU/查，又慢又贵）→ **矩阵加载进程内缓存一次**，写时/定时刷新，DynamoDB 当真相源；冷启动是主要 caveat（provisioned concurrency/常驻服务缓解）；④并发=每进程一份矩阵副本（几百 MB，少量并发无碍）。
- **混合在 A 下怎么做**：进程内 BM25（轻量库/DynamoDB 倒排）+ 进程内稠密暴力，RRF(k=60) 在 Lambda 里融合——无集群复刻 OpenSearch 配方。
- **何时才需 B/C**（拐点）：向量数→几十万–百万+（暴力超交互延迟）；高并发 QPS；想要"一引擎搞定 BM25+向量+RRF"(→B OpenSearch，但常驻集群更贵)；想 SQL+元数据过滤+向量同库(→C pgvector)。**盯的指标是向量数、不是文档数——埋点监控。**

## Sources
- [PEER] HNSW Malkov&Yashunin TPAMI'18 https://arxiv.org/abs/1603.09320 · ANN-Benchmarks Aumüller et al. IS'20 https://arxiv.org/abs/1807.05614 · RRF Cormack et al. SIGIR'09 https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf · BEIR Thakur et al. NeurIPS'21 https://arxiv.org/abs/2104.08663 · Reranking Nogueira&Cho'19 https://arxiv.org/abs/1901.04085 · MTEB EACL'23 https://arxiv.org/abs/2210.07316 · LegalBench-RAG'24 https://arxiv.org/abs/2408.10343
- [MAINT] FAISS choose-index https://github.com/facebookresearch/faiss/wiki/Guidelines-to-choose-an-index · pgvector https://github.com/pgvector/pgvector · ann-benchmarks https://ann-benchmarks.com/ · Elastic RRF https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion
- [VENDOR] AWS DynamoDB Constraints https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Constraints.html · large items https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-use-s3-too.html · RCU https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadWriteCapacityMode.html · Lambda quotas https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html
