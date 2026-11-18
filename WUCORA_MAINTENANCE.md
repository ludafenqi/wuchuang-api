# WuCora 定制与上游同步维护

本 fork 保留 QuantumNous/new-api 的业务实现与提交祖先。外观集中在主题变量、布局和共享组件；合入上游新增业务时，不用旧 `web/` 覆盖，也不整文件选择 ours/theirs。版权头、LICENSE、作者与许可信息继续保留。

## 本轮固定对象与合并状态

- Fork 起点：`a2bd1733f2b48f669fb8bc28272274bbba77f5e8`，已包含 PR #15–#17。
- 前次上游：`f36c460f0e86bb814c88642daf3e4764a3886a8a`；本轮固定上游：`669d774976369e986f03b6e24fff1042f6f94832`。实施中不追加新的上游批次。
- 官方 release `v1.0.0-rc.51`（`c9c6da2786b6a0912215127e78e28fbc6650c85f`）已在 fork 起点中。新增五项为分组倍率默认折叠、渠道标签事务内读取、缓存类别/时长显示、Gemini 原样文本及按模型转换 thinking levels。
- 满意界面参考保持 `.github/wucora-ui.json` 的 `uiReference=b6f0b02864fe13cdd30dd8c443e1af1e53646c5b`、`referenceRun`、`referenceImage` 与 `reviewRequired:true`。
- PR #18 的早期候选 `68123e0c73b426aca00456a38ebea87f789ce891` 及等树合并预览 `5338976556d22bfea71a5d23e22e57f73d3123c2` 已通过候选与 PR 检查。本轮继续整理清单并集中模型详情样式；其后的源码必须按新的准确 SHA 重新验证。最终 PR head、merge commit、运行与镜像摘要以 PR #18 和当轮交付记录为准，避免自引用尚未生成的提交。

## 清单口径

以 `git diff --name-status 669d774976369e986f03b6e24fff1042f6f94832 <审阅提交>` 计算净差异。整理前的已提交候选共有 **256 个差异文件：144 个 web 文件、44 个非测试 Go 文件、30 个 Go 测试文件**，其余为工作流、资源和维护配置；这些数量不是独立功能数量。每轮保存完整路径清单，并在新增/删除文件时刷新数字。

原主工作区 `codex/wucora-functional-parity`、HEAD `c64c4effefab67721e222859b9fef5a79990e779` 的 55 项未提交工作副本单独保留并核对哈希。它们不是本轮发布清单；同名文件也必须按审阅提交逐项比对，不能把旧工作区整体算作已合入或已部署。下表仅登记审阅提交中实际存在的差异。

## 一、品牌、主题与资源

| 目的 | 具体路径 | 相对固定上游的实际差异 | 回归证据 | 后续决策 |
| --- | --- | --- | --- | --- |
| WuCora 品牌及明暗主题 | `web/src/styles/{theme,theme-presets,cloud,home,index}.css`，`web/src/context/theme-provider.tsx`，`web/public/wucora-logo.png`，`web/src/components/layout/components/system-brand.tsx` | 品牌变量、字体、资源与主题组合；保留上游主题预设、密度和圆角设置 | `web/src/styles/__tests__/`、主题上下文测试、三宽度两主题截图 | **保留**品牌值与资源；**适配**上游主题能力，避免为每个业务页面复制颜色 |
| 站点品牌与项目身份分开 | `common/constants.go`，`controller/misc.go`，`web/src/lib/{build-version,build-metadata,status-query}.ts`，`web/src/stores/system-config-store.ts` | 可配置站点默认品牌、真实源码版本/更新来源；`UpstreamSystemName` 与原作者许可身份继续保留 | `controller/misc_branding_test.go`、版本/状态缓存测试、镜像 source revision 与实际资产核对 | **保留**真实 fork 来源；上游具备等价来源/缓存能力时**适配或替代**，不能删除依法必要的归属 |

## 二、页面布局与共享组件

| 目的 | 具体路径 | 相对固定上游的实际差异 | 回归证据 | 后续决策 |
| --- | --- | --- | --- | --- |
| 首页与认证页面的品牌布局 | `web/src/features/home/`，`web/src/features/auth/auth-layout.tsx`，`auth/sign-in/`，`auth/sign-up/` | 品牌区、首页模型展示、接入说明与标题；沿用上游认证表单、hooks、协议及接口 | 首页布局、品牌标题、协议语言/同意状态测试；登录注册与移动端截图 | **保留**外观和内容，**适配**上游表单/协议能力；认证逻辑不搬进主题层、不复制实现 |
| 控制台、导航和表格几何 | `web/src/components/layout/`，`web/src/components/data-table/core/data-table-view.tsx`，`web/src/features/dashboard/`，`web/src/styles/cloud.css` | 工作区壳层、侧栏、导航、卡片及容器内横向滚动 | 导航/数据表测试，控制台三宽度明暗主题及页面溢出检查 | **适配**上游路由、权限、查询和共享组件；上游新增页面先保留入口，再接入公共/控制台布局 |
| 模型详情卡片标题与吸顶标签栏 | `web/src/features/pricing/components/model-details.tsx`，`web/src/styles/cloud.css` | 本轮把卡片边框/间距、标题字体与换行、标签栏背景/吸顶集中到 `wcai-model-header`、`wcai-model-header-row`、`wcai-model-tabs`；组件恢复上游基础类并只增加样式挂接点 | 原 86 项真实网关回归继续保留；三宽度明暗主题计算样式前后对照、标题不截断及滚动时标签栏可达 | **保留**主题样式；上游 `ModelHeader`、`TabsList`、`CopyButton`、定价/权限/路由/API 继续沿用。没有新增复制或标签交互实现 |
| 共享输入、弹窗与主题设置 | `web/src/components/{password-input,config-drawer}.tsx`，`web/src/components/ui/` | 显隐按钮、弹窗和主题偏好布局，兼容现有调用方 | 密码输入/键盘/弹窗测试和响应式浏览器脚本 | **优先替代**为等价上游组件；没有能力缺口就复用、组合或兼容扩展，不造新的通用封装 |

首页内容、管理员页脚编辑器及业务卡片组合承载配置语义，继续留在各 feature。它们不适合全部搬进 CSS。本轮只集中确有分散外观差异的模型详情交叉点，不重设计满意 UI，不复制上游请求、权限、路由和表单状态。后续页面通过现有主题变量、`cloud.css`、公共/控制台布局及共享组件逐步适配。

## 三、后端修复

| 目的/不变量 | 具体路径 | 相对固定上游的实际差异 | 回归证据 | 后续决策 |
| --- | --- | --- | --- | --- |
| 原子订阅退款 | `model/subscription.go` | 退款金额与幂等标记在同一事务，复用已有事务与 `lockForUpdate` 锁顺序 | `model/subscription_refund_test.go` 的回滚/并发请求/参数校验；真实三数据库退款矩阵 | **保留**至上游在相同故障和并发用例下证明等价，再**替代**；不可只看函数名相同 |
| 预扣、Realtime 保留额与结算/退款边界 | `service/quota.go`，`relay/request_billing.go`，`controller/relay.go` | 累计用量扩展同一 BillingSession 保留额；panic 后已处理用量不再额外退款，失败仍走原退款链 | `controller/relay_panic_test.go`，`service/tiered_settle_test.go`；三数据库及独立日志库结算矩阵 | **保留**不重复收费/退款与预扣对账不变量；上游等价修复后**替代**。价格与表达式语义不在外观重构中改变 |
| 流式取消、panic 与 goroutine 退出 | `relay/helper/{stream_scanner,common}.go`，`relay/common/stream_status.go`，`relay/{audio,claude,compatible,gemini,image,responses}_handler.go`，`relay/websocket.go`，OpenAI/Claude/Gemini/xAI 等 adaptor | 传播失败、取消上游并等待读取协程退出；区分已交付内容、尚未处理用量和已结算状态 | stream scanner/Realtime/panic/race 测试；真实 SSE 三数据库结算 | **保留**已发送内容的计费边界与取消语义；上游必须通过相同故障注入后才能**替代** |
| 访问日志、URL 与 panic 脱敏 | `middleware/recover.go`，`logger/{logger,panic}.go`，`relay/common/relay_utils.go`，`relay/channel/api_request.go` | 查询凭据/自定义认证参数与畸形 URL 脱敏；不格式化 panic 对象或栈参数；保留请求关联诊断，日志轮换并发安全 | `middleware/logger_test.go`，`relay/common/relay_utils_test.go`，`relay/channel/api_request_test.go` | **保留**无凭据日志与诊断可用性；上游实现须覆盖异常格式化、轮换、断连和脱敏边界后**替代** |
| Vertex 凭据缓存与失败响应安全 | `relay/channel/vertex/service_account.go` | 缓存身份包含私钥内容摘要，区分槽位和同 ID 轮换；验证 HTTP、可用 token、有效整数到期时间；错误不回显凭据/供应商响应 | `relay/channel/vertex/service_account_test.go`，Vertex race 门禁 | **保留**并发单次交换、密钥隔离、轮换和失效行为；上游等价缓存可**替代**，不能只按邮箱/Key ID 合并 |
| 可重放请求体与取消上下文 | `relay/channel/api_request.go`，已有请求体 metadata 逻辑 | 保留已有 `GetBody`、内容长度及原生不可重放语义；keep-alive 取消关联持续到响应体关闭 | `relay/channel/api_request_getbody_test.go` 的 HTTP/2 reset/GOAWAY、空体/已有 GetBody；keep-alive 取消/race 回归 | **适配**上游传输实现并保留原生重放契约，等价后**替代**补丁；不通过重复发请求掩盖错误 |
| 数据库与渠道回滚 | `controller/channel_multi_key_test.go`，`model/channel_status_test.go`，相关渠道业务路径 | 当前上游已提供渠道标签事务内读取；fork 保留额外设置/清空、读/能力重建失败回滚、并发读提交边界测试，以及渠道创建/panic 回滚保护 | `TestBatchSetChannelTagDatabaseMatrix`、channel create/rollback/MultiKey 测试，SQLite/MySQL/PostgreSQL 和 race | **沿用上游**已等价的生产修复；保留有独立不变量的回归，不能把已无生产差异的上游修复仍算作私有实现 |
| 请求插件的已确认范围不能跨插件复用 | `controller/request_plugin.go`，`setting/request_plugin_setting/config.go` | 保存范围绑定同一插件身份；范围比较保留重复项差异，避免重用旧确认扩大运行范围 | `controller/task_plugin_test.go` 的 `TestRequestPluginInstancesConfirmThePluginScope` | **保留**管理员确认边界；上游具备同一身份与集合语义后**替代**。沿用 Task Plugin API v1，不改 runtime 或插件元数据 |

上述为已存在补丁的维护登记，本轮不改后端计费、认证或插件协议。认证/会话与凭据相关调整继续执行 OWASP Authentication、Session Management、OAuth2 和 ASVS 5.0.0 的适用 read gate；清单及回归通过不代表整站 ASVS 合规认证。插件描述仍遵守 Task Plugin API v1 的简短、等价翻译及“计费主体 + 单价”约定。

## 四、真正的功能扩展

| 能力 | 具体路径与实际差异 | 回归证据 | 后续决策 |
| --- | --- | --- | --- |
| 管理员可配置页脚和首页声明 | `web/src/features/{footer,open-source}/`，`web/src/features/system-settings/footer/`，`web/src/components/layout/components/footer.tsx`，`setting/system_setting/footer.go`，`model/option.go`，`controller/{option,misc}.go`，`router/api-router.go`，`middleware/access_token_routes.go`；增加配置/预览、原子保存 API 与 option:write 路由权限 | 页脚解析/校验/权限/缓存/管理测试，`TestFooterOptionStorageFailureKeepsPublishedValue`、三数据库 `TestFooter` 与真实配置截图 | **保留**现有管理员配置；上游提供等价能力时**迁移适配**，不能丢失保存值或合法开源声明入口 |
| 实际版本与 fork 更新来源 | `web/src/features/system-update/`，版本/状态封装，`controller/misc.go`；展示真实构建来源，避免把官方最新版本误当作本站镜像源码 | 版本解析、状态刷新、镜像 revision 和实际内嵌资产检查 | **保留**可追溯源码；上游统一后**适配**来源配置，不维护一套虚假版本号 |

本轮五项上游更新按原实现接入；其中缓存类别是价格/用量展示能力，不另造结算公式。它们本轮没有新增独立页面路由；未来上游新增页面继续保留 TanStack 路由、上游导航与权限入口，随后适配现有共享布局。

## 五、同步、验证与发布门禁

| 机制 | 实际实现与必须保留的保护 | 回归/证据 |
| --- | --- | --- |
| 候选提交前规范化 | `.github/scripts/prepare-upstream-candidate.mjs` 调用 `normalizeLocales`；严格解析全部顶层 locale（含新增语言），拒绝重复/转义别名键；i18n:sync 后键和值完全相同才暂存并提交；失败恢复原文件并 merge --abort | PR #15 已引入；真实临时 Git 回归覆盖无冲突转义规范化、所有语言、幂等、重复输入/输出、新语言语义变化和中断。当前三个脚本 26 项回归通过，无需重复修复 |
| 真正合并冲突 | `merge-upstream-locales.mjs` 仅处理可严格证明的三方键值合并，通过临时 `add-missing-keys.mjs` 写入；非语言或同键语义冲突失败阻断 | 本批七语言与 static-keys 是真实内容冲突，逐项合并两侧新增块；每语言保留 109 个 fork 独有键和 23 个上游新增键，不放宽合并器、不选择整边 |
| 显式候选与二次检查 | resolved_candidate 必须有双方祖先、准确 pin 和原 UI 政策；保留指定 SHA，不隐式重写；候选在审阅分支先规范化，后续 i18n:sync 必须零差异 | `prepare-upstream-candidate.test.mjs`，七语言严格语义审计和后续 git diff --exit-code 门禁 |
| UI 与后端全套验证 | 两套 CI 保留三个 Go 模块 GOWORK=off vet/build/test、数据库/独立日志/计费/Redis Cluster/race、前端类型/测试/i18n/质量/构建及 86 项真实页面检查 | 新增/改动文件 error 与格式回归为零；保留完整既有 lint/warning 诊断。截图标注实际检出 SHA、场景、宽度、主题；元数据 head 与 PR merge preview 分别记录 |
| GitHub PR 事件批准 | GITHUB_TOKEN 创建或更新 PR 后，GitHub 可能要求维护者选择 Approve workflows to run；用正常运行批准接口补齐，不改仓库安全设置或删检查 | 本轮 44111292754、44111292662 的 attempt 2 已通过，实际检出 53389765；后续新候选必须重新验证，旧绿灯只作历史记录 |
| 固定镜像与实际拉取 | `.github/workflows/wuchuang-publish-ghcr.yml` 只从审查后的准确 main 构建，发布 ghcr.io/ludafenqi/wuchuang-api:sha-完整SHA；记录 registry index/平台摘要和 revision，再按摘要拉取隔离运行与页面验证 | 不能以本地 image ID 或旧镜像代替 registry digest；本轮不额外移动 latest 标签 |

## 每轮操作顺序

1. **固定上游版本**：干净隔离分支 fetch，记录 fork base、完整上游 SHA、新增提交、定制交叉点和原工作区哈希；保护所有旧 worktree，不追赶实施中新增的上游批次。
2. **候选合并**：保留上游祖先，候选提交前做语义无损的翻译规范化；真正冲突逐项解决。显式候选先在审阅分支提交规范化结果，后续零差异检查保留。
3. **功能测试和截图核对**：完整门禁在准确新 SHA 上运行，查看新增功能、首页/登录注册/控制台/定价/页脚及三宽度两主题；同时对照当轮 main 与满意 UI 参考。字体/动态数据差异说明来源，不能把截图数量或构建成功当作功能完整。
4. **审阅 PR 并 merge commit 合并**：核对远端 main 和 PR head 无未审阅漂移，先保存不覆盖既有异向引用的 main 回退分支；必要检查通过后正常结束草稿，以 merge commit 合并，不 squash/rebase/force push。核对新 main 的双亲、tree、UI pin，并验证准确新 main。
5. **构建并验证自有固定版本镜像**：从准确 main 发布固定 SHA 标签，记录 registry digest；按摘要实际拉取，在隔离环境核对源码、标签、架构、资产、接口与页面，保留失败诊断和回滚锚点。
6. **对明确目标部署及回滚检查**：先确认真实主机/架构/方式/目录、当前数据与备份、健康检查及回滚方案，再部署准确 digest。目标缺失时先完成代码和镜像交付并索取缺失信息；历史测试机、旧域名或本地 image ID 不能证明生产目标。部署成功独立记录，不能与 PR 合并或镜像发布混称完成。

质量与截图入口保留在当轮 PR/交付报告中。任何源码变化都须重新审阅和验证；既有 55 项工作副本保持原样。
