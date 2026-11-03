# 平台建模与实现说明

## Skill 的使用方式

本平台应用 `../../ontology-driven-dev/SKILL.md` 的七模型语义分工、M6 与 M7 建模约束、源码证据链与 UI/UE 指导。分析内核来自 CardDemo 已有的反向建模脚本，复制到平台自有目录并进行仓库参数化、模块布局归一化和通用适配。

用户明确要求「技术组件尽量简化，只做技术原型」，因此本实现使用 Node.js 原生 HTTP + SQLite + Python 标准库 + 无构建前端，未整体复制 Skill 中完整技术底座。源码解析不调用目标仓库内的分析脚本，不将新仓库直接套入 CardDemo 数据。

## 平台自己的业务语义

| 模型 | 平台中的含义 | 对应实现 |
|---|---|---|
| M1 对象 | RepositoryProject、AnalysisJob、OntologySnapshot、ModelNode、ModelRelation、SourceEvidence、Review、SemanticOverride | SQLite 项目/任务/快照表；产物中的节点、关系及证据；评审和修订表 |
| M2 行为 | 接入仓库、启动/取消分析、查看快照、查看源码、修订语义、评审、导出、证据检索 | `server/index.mjs` 的项目/任务/数据/源码/评审/修订/导出/助手 API |
| M3 规则 | 输入范围、支持语言、来源访问约束、引用一致性、快照范围隔离 | `validateRepository`、worker 文件限额、source 路径及证据校验、`validate_models.py` |
| M5 主体 | 本机工作空间使用者；不引入虚构登录及管理员权限体系 | localhost 限定、来源检查；无多人账号系统 |
| M6 流程 | 接入→排队→获取/扫描→隔离输入→提取→校验→保存；失败/取消为终止分支 | `server/jobs.mjs`、`analyzer/worker.py` |
| M7 查询 | 项目概况、模型目录、关系邻接、覆盖矩阵、流程目录、查询契约、待评审元素、任务历史、快照历史 | `/api/bootstrap`、项目 data/snapshots、`/api/jobs`；前端按当前快照聚合与筛选 |
| MU 界面 | 总览、图谱、七模型、流程、查询、评审、任务、导出、能力设置 | `public/app.js` 九个功能视图；详情抽屉、源码/评审/编辑对话框 |

## 分析状态与一致性

任务：`queued → running → completed / failed / cancelled`。单并发内存调度，状态写入 SQLite。进程重启将遗留 running 任务标记失败，queued 任务继续。

每次成功分析新增快照；只有成功结果成为项目当前快照。失败/取消不会替换上一次可用结果。人工修订保存在 `(snapshot_id, node_id)` 上，导出时合并；原始源码与原始分析文件保留。新快照不自动继承旧快照的人工评审，避免把旧结论误套到变更后的代码。

## 通用与定向适配的分界

通用 Java 适配器识别标准源码结构与 Spring REST/JPA/响应契约。CardDemo 定向生命周期、A/U 用户角色、已核对统计口径仅在识别到该工程结构时使用。不能恢复的内容保留待评审或空集合。通用 MU 是候选交互契约，不能当作真实业务页面覆盖。

`CODE`、`MAPPED`、`reviewRequired`、字段 `mappingStatus` 保留证据强度差异。应用方法 CFG 的分支是静态解释，不是引擎部署的可执行 BPMN。M3 Java 策略登记也不是规则引擎已配置。

## 原型范围之外

没有执行目标系统、自动部署流程或规则，没有业务数据库采样、运行时追踪、跨语言深度语义、多租户账号和多人审签，也不保证完整 Java AST 覆盖。后续如接入 LLM，应继续保留来源证据、模型验证和人工评审，不直接将生成文本当作已确认事实。
