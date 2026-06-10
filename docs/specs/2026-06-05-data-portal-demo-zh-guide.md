# Indigenomics Data Portal — Demo 中文导读

> 这是英文设计文档 **`2026-06-05-data-portal-demo-design.md`** 的中文导读。
> **代码、接口、数据模型以英文 spec 为准**(本文只讲"为什么 + 谁干嘛",并指向对应英文章节 §)。
> 给谁看:整个 capstone 团队 —— **数据架构组**、**Nate(公司侧)**、**Jack(供应商 + Indigenomics 侧)**。

---

## 一句话产品

我们建 **Indigenomics Data Portal** —— 一个基于 consent、原住民治理的**已验证经济数据基础设施**。
核心洞察:**今天企业的原住民经济数据(如"我们花了 $757M 在原住民供应商")全是自报、从没被对方确认。我们补上缺的那一层 —— 被点名的原住民供应商来确认/反驳每一条。采集不是创新,确认才是。**(详见英文 §1)

## 我们在建什么(6/24 MVP)

一句话 demo:**以公司身份填问卷(逐条上报、点名供应商)→ 切换成某供应商 → 确认/驳回一条 → 看覆盖率视图随之变化(reported vs confirmed)。** 全程合成数据、DynamoDB Local、端到端。(范围与 Definition of Done 见英文 §2)

## 三个受众 / 五个页面 / 到人分工

| 受众 | 页面 | 谁 |
|---|---|---|
| 公司 | `report`(问卷)、`coverage`(单公司覆盖率) | **Nate** |
| 供应商 | `confirm`(确认/驳回)、`record`(My Record:关于我的 claim + 已确认收入) | **Jack** |
| Indigenomics | `analytics`(跨公司宏观 RAP 分析 / Index) | **Jack** |
| 共享 | role-switcher、`components/` 设计系统 | 结对 |
| 底层 | DynamoDB 单表、`repo` 实现、身份分层、撤回、合成种子数据 | **Sunny**(写入/基建)· **Sharon**(读取/聚合/数据集) |

(详见英文 §5 文件树、§10/§10.1 分工表)

## 最重要的一条规则:两组只在一个文件对接

**整个协作靠 contract-first:两个组只共享 `src/lib/repo/types.ts`(那个 `PortalRepo` 接口)。**
- 接口**以下**(DynamoDB)= 数据组;接口**以上**(React 页面)= Nate/Jack。
- 数据组先写 `repo.mock.ts`(内存假实现),Nate/Jack **第一天就能在假数据上开发**;最后整合 = 改一个环境变量 `REPO_IMPL=dynamo`,前端一行不用动。
- 谁也不卡谁。(接口全文见英文 §7;数据模型见 §6 / §6.1)

## 技术栈

Next.js + TypeScript + Tailwind(fork 之前 gatekeeper 的设计)· **AWS DynamoDB 单表** · 本地用 **DynamoDB Local(Docker)** · 登录暂用**角色切换器**(不做真鉴权)· 部署 Vercel · **AWS 密钥只在服务端、不进 git**。(详见英文 §4)

## 几个关键概念

- **身份分层(identity tier)**:供应商分 `nation / ccab / self_declared`,公司选供应商时显示 tier 徽章。这是防 black-cladding 欺诈的第一道。(§8)
- **OCAP(数据主权)= 确认引擎的另一面**:Ownership/Control/Access/Possession 四项里有三项就是你们要建的功能 —— **Control = 确认/驳回/撤回,Access = 导出,Possession = 数据归 Indigenomics 治理**。不是额外模块。(§9)
- **撤回规则**(数据组照此实现):供应商撤回 = **软删**自己的确认,那条线**回到 `pending`**,公司上报的 claim **还在**(那是公司的数据)→ 覆盖率当场掉。**永不硬删。**(§9)

## 澳洲 vs Indigenomics(为什么这么定)

读了澳洲 2025 RAP Impact Survey + 麦肯锡 RAP + Indigenomics RAP Hub 后定的:
- **Taxonomy 用 Indigenomics 的 4 支柱**(equity / capital / procurement / innovation)—— 它们全是经济的、大多可确认,是真正 partner 的语言。**不用**澳洲的 Relationships/Respect/Opportunities/Governance(那套只有 1/4 可确认)。
- **机制借澳洲的**:采购金额区间、certified-vs-self 双层、年度节奏。
- **MVP 旗舰 = procurement;equity 是高价值第二个**(JV/股权造假正是丑闻核心)。(详见英文 §6.1、§14 决策记录)

## demo 之外(知道但不做)

英文 §15 列了 8 条 whole-product 缺口(身份核验、承诺层、dispute 工作流、触达引擎、买方价值闭环、admin、隐私、生命周期)+ **AI 定位**:
> **AI 属于引擎,不属于店面。** advisory "RAP Co-pilot" 维持砍掉;AI 的家是 H2 的后台 agent(ingestion / entity-resolution / integrity-anomaly),跑在主权基础设施上。**demo 里不放任何 AI。**

## 协作流程

1. **第一次联合会议**(全员):一起定 access-pattern 清单 + 写 `repo/types.ts`,提交后再分头。
2. **walking skeleton**(全员):最细一条线 —— 1 条上报 → 1 次确认 → 覆盖率 1/1,证明接缝通。
3. **并行**:数据组 mock 先行;Nate/Jack 在 mock 上做页面。
4. **整合**:`REPO_IMPL=dynamo`。
5. **同步规则**:只有改 `types.ts` 要通知两组,其余互不打扰。(详见英文 §11、§12 里程碑)

---

**下一步**:设计已锁定 → 出**到人、按周排期的实现计划**(walking skeleton → 6/24)。✅ 已落地为 `docs/sprint1/` + `docs/sprint2/`(轮值、卡、velocity)。

---

## 更新 [2026-06-10]

三个**产品级**决定已提升回英文 spec(§2 Scope evolution / §6.1 / §10 / §13 / §14),设计细节见附件 `sprint2/02`、`sprint2/03`:

1. **三门户 + 假登录分流**(公司 / 供应商 / Indigenomics)替代单一角色切换页 —— 仅信息架构,**真实认证仍 H2**。
2. **问卷扩到 采购 + 股权**(可确认)+ 公司档案 + 只读"自报未验证"背景区;规则:**有具名原住民对手方才可确认**。
3. **供应商自助注册:已建**(原为 stretch)。
4. **归属**:数据组负责 **Indigenomics 门户 + AWS 部署**;Jack = 供应商门户;公司侧 = 报告表单 + 注册。

> 关系:**产品文档定方向(source of truth)→ sprint 排执行**。产品决定先落产品文档,sprint board 只引用为卡。
