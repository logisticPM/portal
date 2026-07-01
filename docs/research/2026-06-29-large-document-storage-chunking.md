# 大文档存储 / 长文档分块 文献 —— DynamoDB 400KB 与 RAG 底料

> 研究日期：2026-06-29。问题：判决全文内联存进 DynamoDB 单 item 超 400KB（`ValidationException`）。选项 A 截断 / B 拆成多 item（每 chunk 一条，垂直分区） / C 全文进 S3+指针。
> 标注：[AWS-DOC]=官方文档；[AWS-BLOG]=AWS 博客；[EXPERT]=DeBrie；[PEER]=同行评审；[PREPRINT]=arXiv；[INFER]=推断。

## Strand 1 — 系统/工程最佳实践（400KB 大对象）
- [AWS-DOC] DynamoDB 单 item 上限 **400KB**（含属性名+值的 UTF-8 字节）；超限 `ValidationException`。([Constraints](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Constraints.html))
- [AWS-DOC] 官方《Best practices for storing large items》明列**三个**办法、且**从不建议"丢数据"**：①**压缩**（GZIP/LZO 存 Binary，但"压缩值无法用于过滤"，且仍受 400KB 限制）；②**拆成多 item**（按同一 partition key 分组成 item collection，sort key 标识，Query 重组）；③**存 S3、item 存对象 key**（但 **DynamoDB↔S3 无事务**→孤儿对象要自己清；S3 文本无法被 DynamoDB FilterExpression 过滤）。([bp-use-s3-too](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-use-s3-too.html))
- [AWS-BLOG] 垂直分区：拆小、同 PK 分组、`Query`+`begins_with` 重组（按 SK 排序）。([vertical partitioning](https://aws.amazon.com/blogs/database/use-vertical-partitioning-to-scale-data-efficiently-in-amazon-dynamodb/)) [EXPERT] DeBrie：item collection 是单表设计"预连接"的单元；400KB 是必知三限之一。
- [AWS-DOC] 拆分写入受限：事务≤100 item/4MB、BatchWrite≤25/次 → 几百段的判决**无法一次原子写**，要分批、partial-write 自己兜。
- [AWS-DOC] Well-Architected PERF03-BP01："用专用存储"——大 blob 进对象存储、索引/元数据进 KV 库（blob 外置模式）。

## Strand 2 — 学术 ML/IR（长文档分块/表示）
- [PEER] **RAPTOR**（ICLR 2024）：递归聚类+摘要成多层树；动机正是 flat chunking 对长文档的失败。([2401.18059](https://arxiv.org/abs/2401.18059))
- [PREPRINT] **Late Chunking**（Jina 2024）：先整文编码再切块，chunk 嵌入保留全文上下文。([2409.04701](https://arxiv.org/abs/2409.04701))
- [PEER] **ColBERT**（SIGIR 2020）/ ColBERTv2（NAACL 2022）：每 token 一向量、late interaction——单向量表达不了长文档，需 passage/token 级单元。
- [PREPRINT] **LegalBench-RAG**（2024）：法律 RAG 需"检索最小高相关片段"，不是粗粒度返回整文 → 细粒度 chunk 检索单元。([2408.10343](https://arxiv.org/abs/2408.10343))
- [PEER] **法律修辞角色分割**（NLLP@EMNLP 2022）：判决分 Facts/Argument/Statute/Precedent/**Ruling**/**Ratio**——支持结构感知分块。([2022.nllp-1.13](https://aclanthology.org/2022.nllp-1.13/))
- **截断的代价（关键）**：[PEER+INFER] 判决里最关键的 **ratio/holding（判决理由/裁决）通常在中后段**，不在开头 → **头部截断会丢掉 holding**（precedent 检索最相关的内容）。这是结构性证据，不是猜测。

## Strand 3 — 映射到 A/B/C（结论）

**推荐：B（每 chunk 一个 DynamoDB item / 垂直分区）现在做；C（S3）以后随向量索引一起上。**

| 方案 | 系统侧 | IR/RAG 侧 | 与本代码契合 | 裁决 |
|---|---|---|---|---|
| **A 截断** | 不在 AWS 推荐里（从不建议丢数据） | **最差**——丢 holding；且 `include.ts` 拼接所有 chunk 文本，**截断可能把 include 判定从 true 翻成 false → 污染 PRISMA 筛选本身** | 简单 | **陷阱，连"安全过渡"都算不上** |
| **B 多 item** | AWS 明确背书的大 item 解法 | chunk **本身就是 RAG 检索单元**（LegalBench-RAG/ColBERT/RAPTOR）→ 存储=检索粒度一致 | **最高**——`chunkText` 已产出 `{paragraph,text}` 记录，映射成 `SK:CHUNK#n` 近乎机械改动 | **推荐** |
| **C S3+指针** | AWS 背书、blob 外置最佳、最适合归档 | 匹配"源文 in 对象存储 + 独立向量索引"的生产形态 | 需 S3 基建；S3 文本不可被 DynamoDB 过滤 | **长期归宿，与 B 组合** |

**为什么从 A 改判到 B**：①截断对判决会丢 holding（中后段）；②更糟——`include.ts` 拼接全部 chunk 文本判定纳入，截断可能让"信号在被截掉的后段"的案例被**错误排除**，污染 PRISMA；③**B 几乎不比 A 多花功夫**（chunk 边界已存在），所以没理由为 A 担那个风险。B 无损、文本仍可被 DynamoDB 过滤、且今天的存储记录就是明天的检索记录。

**B 的代价（诚实说）**：重组靠 `Query`（RCU 与读大 item 相当 + 每 item 小开销）；写入非原子（分批 25、partial-write 自己兜）；默认最终一致读；改动涉及 `cases-table.ts`（PROFILE + CHUNK# 拆分）+ `repo.dynamo`（getCase/scan 重组）+ 测试——比原计划（内联）大。

## Sources
- AWS Constraints https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Constraints.html · Large items best practices https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-use-s3-too.html · Vertical partitioning https://aws.amazon.com/blogs/database/use-vertical-partitioning-to-scale-data-efficiently-in-amazon-dynamodb/ · Well-Architected PERF03-BP01 https://docs.aws.amazon.com/wellarchitected/latest/framework/perf_data_use_purpose_built_data_store.html · DeBrie limits https://www.alexdebrie.com/posts/dynamodb-limits/
- RAPTOR https://arxiv.org/abs/2401.18059 · Late Chunking https://arxiv.org/abs/2409.04701 · ColBERT https://arxiv.org/abs/2004.12832 · ColBERTv2 https://aclanthology.org/2022.naacl-main.272.pdf · LegalBench-RAG https://arxiv.org/abs/2408.10343 · 修辞角色分割 https://aclanthology.org/2022.nllp-1.13/ · Mix-of-Granularity https://arxiv.org/pdf/2406.00456
