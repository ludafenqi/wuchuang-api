# WuCora 定制与上游同步维护

本 fork 保留 QuantumNous/new-api 的业务实现与提交祖先。外观集中在主题变量、布局和共享组件；合入上游新增业务时，不用旧 `web/` 覆盖，也不整文件选择 ours/theirs。版权头、LICENSE、作者与许可信息继续保留。

## 品牌资源优化（2026-11-19）

基于 PR #19 已验证并合并的 `9cff2ff88d0a5e39662a010cfc58d6e4cd1a5891` 独立实施，不追加上游批次，不改写 PR #19 的发布记录；这些新资源不属于此前已发布的镜像。

| 实际用途 | 资源 | 像素尺寸 | 字节数 | 相对旧 PNG 减少 |
| --- | --- | --- | --- | --- |
| 导航、侧栏、登录及演示页脚；支持最大 36 CSS px 的 3× DPR | `web/public/wucora-logo-128.webp` | 128×128 | 9,092 | 99.151% |
| 首页装饰及页脚；支持最大 64 CSS px 的 3× DPR | `web/public/wucora-logo-192.webp` | 192×192 | 15,750 | 98.529% |
| 独立浏览器图标 | `web/public/wucora-favicon.ico` | 16、32、48 | 5,123 | 99.522% |
| 旧配置和直接链接的兼容入口 | `web/public/wucora-logo.png` | 192×192 | 24,457 | 97.716% |

- 发布基线原图为 1254×1254、1,070,741 字节的 RGB PNG，没有透明通道；保留原白底、方形留白、颜色和比例，不抠图、裁切或重绘。采用 Lanczos3 缩放后无损编码；完整原图及 SHA256 随审阅证据保留。
- `SITE_BRAND` 的前端默认图改用 128px WebP；Rsbuild 与 `applySystemBrandingToDom` 使用独立 ICO。`resolveBrandLogo` 仅将同源的旧默认路径（含查询参数）和新资源路径按用途归一，外部同名文件仍视作管理员自定义图；后端默认 `common.Logo` 及已保存设置无需迁移。
- 继续复用 `SystemBrand`，兼容扩展已有 `HeaderLogo` 供首页和页脚组合；固定显示框和 CSS 尺寸保持。失败时只对当前图片或 favicon 回退，不覆盖管理员配置，也不无限重试默认资源。`useSystemConfig` 预加载显示图，不再由图片完成事件覆盖 favicon；缓存初始化、网络刷新和配置订阅仍由现有入口统一更新。
- 在既有 `status-query.test.tsx` 补充默认 favicon、持久化旧配置、网络自定义更新、清除及加载失败回退的行为回归；生产构建的真实网关截图、DPR、MIME/缓存和 Network 传输证据随独立 PR 交付。未修改认证业务、权限、路由、接口、数据库或上游归属；原 55 项工作副本继续逐路径/哈希保护。

## PR #19：固定对象与审阅边界（历史记录）

- Fork 起点：`3d30c673ddc3d70b43fdb176e5ee9b552e59893d`（PR #18 已合并）；前次上游 `669d774976369e986f03b6e24fff1042f6f94832`，本轮固定上游 **`a1d1fb0cca76d3a1a7f3a1995d09abd1e9804c73`**。不追加实施中的新上游批次。
- 上游三个提交：`3546e9382` 为 GPT-6.2 Astra/Sol 的 Chat 参数兼容，`58f786fbf` 说明 Midjourney 图像公开访问的既有行为，`a1d1fb0cc` 说明 root 发布站点内容的安全报告边界。后两项仅为安全政策说明，不是新增匿名访问或放宽 HTML/权限控制。
- 初始候选 `c3d778c7cbd63843d29b4837f5217ffc9e3bc84e` 包含保留双方祖先的 `74a1ab142`。审阅补充沿用现有 controller 测试文件，覆盖两个新模型的流式/快照/采样参数及 max token 显式零值；生产实现继续与固定上游一致。最终候选、merge commit、运行及镜像摘要以 PR #19 的准确记录为准。
- 满意 UI 参考仍为 `b6f0b02864fe13cdd30dd8c443e1af1e53646c5b`，原 referenceRun/referenceImage/reviewRequired 保留。上一轮已发布并实际拉取验证的基线是 `ghcr.io/ludafenqi/wuchuang-api@sha256:3c9466f85d7b7824e84517b0777e816bdacbe0415eb97abb928cb3aa81cc2987`，产品源码为上述 fork 起点。
- **本轮 UI 集中结论：没有新的前端交叉路径或页面。** 候选整个 `web/` Git tree 与本轮起点相同；沿用 PR #18 集中到 cloud.css 的模型标题/吸顶标签栏和现有业务组件。没有适合本批次再迁移的分散样式，不强加重构。原业务逻辑、权限、路由、接口和新增页面接入约定保持。
- [OpenAI 当前模型指南](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6.2-astra) 确认这两个模型的 Chat 请求须去掉 temperature/top_p/logprobs/top_logprobs。此次保留上游 Chat 适配边界，不新增模型价格、不改用量结算，也不把该改动写成 Responses/工具调用的新实现；回归使用支持的 low/high reasoning 值，不强迫无效 provider 参数进入生产。
- 安全文档复核：`/mj/image/:id` 注册在 TokenAuth 之前，只公开图像；任务和修改路由仍经认证/分发。站点设置保留 RootAuth，About 的 HTML 继续经过 DOMPurify 和受限 iframe；新增说明仍将越权、清洗/隔离绕过列为可报告漏洞。对照 [Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)、[Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)、[XSS Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html) 与 ASVS 5.0.0 的相关边界；本轮不改认证/会话实现，不据此声称整站 ASVS 合规。
- 原 55 项工作副本继续保留，未从中复制任何文件。本轮相关 adaptor 的 TTS panic 传播补丁已经在干净基线中，Chat 策略由独立 relaykit 模块提供；下面逐项登记筛选结论。

## 清单口径

以 `git diff --name-status a1d1fb0cca76d3a1a7f3a1995d09abd1e9804c73 <审阅提交>` 计算净差异。本轮审阅候选共有 **257 个差异文件：144 个 web 文件、44 个非测试 Go 文件、31 个 Go 测试文件**，其余为工作流、资源和维护配置；这些数量不是独立功能数量。每轮保存完整路径清单，并在新增/删除文件时刷新数字。

原主工作区 `codex/wucora-functional-parity`、HEAD `c64c4effefab67721e222859b9fef5a79990e779` 的 55 项未提交工作副本单独保留并核对哈希。它们不是本轮发布清单；同名文件也必须按审阅提交逐项比对，不能把旧工作区整体算作已合入或已部署。下表仅登记审阅提交中实际存在的差异。

## 原 55 项工作副本：本轮逐项筛选

“已落地”只表示整份文件在 CRLF→LF 后内容相同；“继续保留待处理”不表示相应修复没有落地，可能已被拆分或被后续上游改写，不能据此复制旧文件。16 项完整内容等价，1 项为本轮相关路径，38 项继续保留；本轮从旧副本新增采用 **0 项**。原 HEAD、分支、状态路径和全部 SHA256 每轮分别核对，机器清单随交付记录保留。

| 原工作副本路径 | 本轮结论 |
| --- | --- |
| `controller/option_gemini_test.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `controller/relay.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `controller/relay_stream_test.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `docs/plugin-api/v1.md` | 继续保留待处理：未确认整份内容等价，未导入 |
| `logger/logger.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `main.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `middleware/logger_test.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `middleware/recover.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `model/subscription.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `relay/audio_handler.go` | 已落地：规范换行后完整内容相同 |
| `relay/channel/advancedcustom/adaptor_test.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `relay/channel/api_request.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `relay/channel/api_request_getbody_test.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `relay/channel/api_request_test.go` | 已落地：规范换行后完整内容相同 |
| `relay/channel/baidu/relay-baidu.go` | 已落地：规范换行后完整内容相同 |
| `relay/channel/claude/relay-claude.go` | 已落地：规范换行后完整内容相同 |
| `relay/channel/claude/relay_responses.go` | 已落地：规范换行后完整内容相同 |
| `relay/channel/dify/relay-dify.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `relay/channel/gemini/relay-gemini.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `relay/channel/gemini/relay_responses.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `relay/channel/openai/adaptor.go` | 相关路径已复核：基线已有 TTS panic 传播；Chat 继续调用新 relaykit 策略，未导入旧副本 |
| `relay/channel/openai/chat_via_responses.go` | 已落地：规范换行后完整内容相同 |
| `relay/channel/openai/relay-openai.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `relay/channel/openai/relay_image.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `relay/channel/openai/relay_realtime.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `relay/channel/openai/relay_responses.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `relay/channel/openai/responses_via_chat.go` | 已落地：规范换行后完整内容相同 |
| `relay/channel/xai/text.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `relay/claude_handler.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `relay/common/relay_utils.go` | 已落地：规范换行后完整内容相同 |
| `relay/common/relay_utils_test.go` | 已落地：规范换行后完整内容相同 |
| `relay/common/stream_status.go` | 已落地：规范换行后完整内容相同 |
| `relay/compatible_handler.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `relay/gemini_handler.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `relay/helper/common.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `relay/helper/stream_scanner.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `relay/helper/stream_scanner_test.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `relay/image_handler.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `relay/request_billing.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `relay/responses_handler.go` | 已落地：规范换行后完整内容相同 |
| `relay/websocket.go` | 已落地：规范换行后完整内容相同 |
| `service/task_polling_test.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `service/text_quota_test.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `web/src/features/footer/__tests__/footer.test.tsx` | 继续保留待处理：未确认整份内容等价，未导入 |
| `web/src/features/footer/config.ts` | 已落地：规范换行后完整内容相同 |
| `web/src/features/system-settings/footer/__tests__/cache-refresh.test.tsx` | 继续保留待处理：未确认整份内容等价，未导入 |
| `web/src/features/system-settings/footer/__tests__/management.test.tsx` | 已落地：规范换行后完整内容相同 |
| `web/src/features/system-settings/footer/link-editor.tsx` | 已落地：规范换行后完整内容相同 |
| `web/src/features/system-settings/footer/section.tsx` | 继续保留待处理：未确认整份内容等价，未导入 |
| `controller/relay_panic_test.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `logger/panic.go` | 已落地：规范换行后完整内容相同 |
| `middleware/recover_test.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `model/subscription_refund_test.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `relay/channel/openai/relay_realtime_test.go` | 继续保留待处理：未确认整份内容等价，未导入 |
| `relay/stream_panic_test.go` | 继续保留待处理：未确认整份内容等价，未导入 |

## 一、品牌、主题与资源

| 目的 | 具体路径 | 相对固定上游的实际差异 | 回归证据 | 后续决策 |
| --- | --- | --- | --- | --- |
| WuCora 品牌及明暗主题 | `web/src/styles/{theme,theme-presets,cloud,home,index}.css`，`web/src/context/theme-provider.tsx`，`web/public/wucora-{logo*,favicon.ico}`，`web/src/lib/{site-branding,dom-utils}.ts`，共享 `SystemBrand`/`HeaderLogo` | 品牌变量、字体、资源与主题组合；按显示尺寸选择无损 WebP 和独立 ICO，旧 PNG 保留小型兼容入口；保留上游主题预设、密度和圆角设置 | 品牌状态/缓存及失败回退测试、主题上下文测试、真实网关多宽度/主题/DPR截图与资源传输记录 | **保留**品牌图案、比例与自定义配置语义；**适配**上游主题能力，避免大图充当 favicon 或重复品牌实现 |
| 站点品牌与项目身份分开 | `common/constants.go`，`controller/misc.go`，`web/src/lib/{build-version,build-metadata,status-query}.ts`，`web/src/stores/system-config-store.ts` | 可配置站点默认品牌、真实源码版本/更新来源；`UpstreamSystemName` 与原作者许可身份继续保留 | `controller/misc_branding_test.go`、版本/状态缓存测试、镜像 source revision 与实际资产核对 | **保留**真实 fork 来源；上游具备等价来源/缓存能力时**适配或替代**，不能删除依法必要的归属 |

## 二、页面布局与共享组件

| 目的 | 具体路径 | 相对固定上游的实际差异 | 回归证据 | 后续决策 |
| --- | --- | --- | --- | --- |
| 首页与认证页面的品牌布局 | `web/src/features/home/`，`web/src/features/auth/auth-layout.tsx`，`auth/sign-in/`，`auth/sign-up/` | 品牌区、首页模型展示、接入说明与标题；沿用上游认证表单、hooks、协议及接口 | 首页布局、品牌标题、协议语言/同意状态测试；登录注册与移动端截图 | **保留**外观和内容，**适配**上游表单/协议能力；认证逻辑不搬进主题层、不复制实现 |
| 控制台、导航和表格几何 | `web/src/components/layout/`，`web/src/components/data-table/core/data-table-view.tsx`，`web/src/features/dashboard/`，`web/src/styles/cloud.css` | 工作区壳层、侧栏、导航、卡片及容器内横向滚动 | 导航/数据表测试，控制台三宽度明暗主题及页面溢出检查 | **适配**上游路由、权限、查询和共享组件；上游新增页面先保留入口，再接入公共/控制台布局 |
| 模型详情卡片标题与吸顶标签栏 | `web/src/features/pricing/components/model-details.tsx`，`web/src/styles/cloud.css` | PR #18 已把卡片边框/间距、标题字体与换行、标签栏背景/吸顶集中到 `wcai-model-header`、`wcai-model-header-row`、`wcai-model-tabs`；组件恢复上游基础类并只增加样式挂接点 | 原 86 项真实网关回归继续保留；三宽度明暗主题计算样式前后对照、标题不截断及滚动时标签栏可达 | **保留**主题样式；上游 `ModelHeader`、`TabsList`、`CopyButton`、定价/权限/路由/API 继续沿用。没有新增复制或标签交互实现 |
| 共享输入、弹窗与主题设置 | `web/src/components/{password-input,config-drawer}.tsx`，`web/src/components/ui/` | 显隐按钮、弹窗和主题偏好布局，兼容现有调用方 | 密码输入/键盘/弹窗测试和响应式浏览器脚本 | **优先替代**为等价上游组件；没有能力缺口就复用、组合或兼容扩展，不造新的通用封装 |

首页内容、管理员页脚编辑器及业务卡片组合承载配置语义，继续留在各 feature。它们不适合全部搬进 CSS。PR #18 只集中确有分散外观差异的模型详情交叉点；本轮没有新 UI 交叉点，不重设计满意 UI，不复制上游请求、权限、路由和表单状态。后续页面通过现有主题变量、`cloud.css`、公共/控制台布局及共享组件逐步适配。

## 三、后端修复

| 目的/不变量 | 具体路径 | 相对固定上游的实际差异 | 回归证据 | 后续决策 |
| --- | --- | --- | --- | --- |
| GPT-6.2 Chat 参数兼容 | `relaykit/dto/openai_request.go`，`controller/channel_test_request_test.go` | 本轮沿用上游的两个模型/合法日期快照识别；转换 max token 字段、首条 system→developer，移除不支持的采样字段；不匹配的命名变体保留原行为 | 现有 Chat compatibility/sampling/token-limit 表格回归，覆盖 Azure 流式、low/high、快照及遗漏/零值/双字段；三个 Go 模块独立构建 | **沿用上游**生产修复；保留本轮补充的实际序列化契约，不复制旧 adaptor 或重新实现模型策略 |
| 原子订阅退款 | `model/subscription.go` | 退款金额与幂等标记在同一事务，复用已有事务与 `lockForUpdate` 锁顺序 | `model/subscription_refund_test.go` 的回滚/并发请求/参数校验；真实三数据库退款矩阵 | **保留**至上游在相同故障和并发用例下证明等价，再**替代**；不可只看函数名相同 |
| 预扣、Realtime 保留额与结算/退款边界 | `service/quota.go`，`relay/request_billing.go`，`controller/relay.go` | 累计用量扩展同一 BillingSession 保留额；panic 后已处理用量不再额外退款，失败仍走原退款链 | `controller/relay_panic_test.go`，`service/tiered_settle_test.go`；三数据库及独立日志库结算矩阵 | **保留**不重复收费/退款与预扣对账不变量；上游等价修复后**替代**。价格与表达式语义不在外观重构中改变 |
| 流式取消、panic 与 goroutine 退出 | `relay/helper/{stream_scanner,common}.go`，`relay/common/stream_status.go`，`relay/{audio,claude,compatible,gemini,image,responses}_handler.go`，`relay/websocket.go`，OpenAI/Claude/Gemini/xAI 等 adaptor | 传播失败、取消上游并等待读取协程退出；区分已交付内容、尚未处理用量和已结算状态 | stream scanner/Realtime/panic/race 测试；真实 SSE 三数据库结算 | **保留**已发送内容的计费边界与取消语义；上游必须通过相同故障注入后才能**替代** |
| 访问日志、URL 与 panic 脱敏 | `middleware/recover.go`，`logger/{logger,panic}.go`，`relay/common/relay_utils.go`，`relay/channel/api_request.go` | 查询凭据/自定义认证参数与畸形 URL 脱敏；不格式化 panic 对象或栈参数；保留请求关联诊断，日志轮换并发安全 | `middleware/logger_test.go`，`relay/common/relay_utils_test.go`，`relay/channel/api_request_test.go` | **保留**无凭据日志与诊断可用性；上游实现须覆盖异常格式化、轮换、断连和脱敏边界后**替代** |
| Vertex 凭据缓存与失败响应安全 | `relay/channel/vertex/service_account.go` | 缓存身份包含私钥内容摘要，区分槽位和同 ID 轮换；验证 HTTP、可用 token、有效整数到期时间；错误不回显凭据/供应商响应 | `relay/channel/vertex/service_account_test.go`，Vertex race 门禁 | **保留**并发单次交换、密钥隔离、轮换和失效行为；上游等价缓存可**替代**，不能只按邮箱/Key ID 合并 |
| 可重放请求体与取消上下文 | `relay/channel/api_request.go`，已有请求体 metadata 逻辑 | 保留已有 `GetBody`、内容长度及原生不可重放语义；keep-alive 取消关联持续到响应体关闭 | `relay/channel/api_request_getbody_test.go` 的 HTTP/2 reset/GOAWAY、空体/已有 GetBody；keep-alive 取消/race 回归 | **适配**上游传输实现并保留原生重放契约，等价后**替代**补丁；不通过重复发请求掩盖错误 |
| 数据库与渠道回滚 | `controller/channel_multi_key_test.go`，`model/channel_status_test.go`，相关渠道业务路径 | 当前上游已提供渠道标签事务内读取；fork 保留额外设置/清空、读/能力重建失败回滚、并发读提交边界测试，以及渠道创建/panic 回滚保护 | `TestBatchSetChannelTagDatabaseMatrix`、channel create/rollback/MultiKey 测试，SQLite/MySQL/PostgreSQL 和 race | **沿用上游**已等价的生产修复；保留有独立不变量的回归，不能把已无生产差异的上游修复仍算作私有实现 |
| 请求插件的已确认范围不能跨插件复用 | `controller/request_plugin.go`，`setting/request_plugin_setting/config.go` | 保存范围绑定同一插件身份；范围比较保留重复项差异，避免重用旧确认扩大运行范围 | `controller/task_plugin_test.go` 的 `TestRequestPluginInstancesConfirmThePluginScope` | **保留**管理员确认边界；上游具备同一身份与集合语义后**替代**。沿用 Task Plugin API v1，不改 runtime 或插件元数据 |

上述为已存在补丁的维护登记。本轮 Chat max-token 字段兼容已读取 billing.md 并保留数值/零值边界；不修改价格、用量派生、预扣/结算/退款实现、认证或插件协议。认证/会话与凭据相关调整继续执行 OWASP Authentication、Session Management、OAuth2 和 ASVS 5.0.0 的适用 read gate；清单及回归通过不代表整站 ASVS 合规认证。插件描述仍遵守 Task Plugin API v1 的简短、等价翻译及“计费主体 + 单价”约定。

## 四、真正的功能扩展

| 能力 | 具体路径与实际差异 | 回归证据 | 后续决策 |
| --- | --- | --- | --- |
| 管理员可配置页脚和首页声明 | `web/src/features/{footer,open-source}/`，`web/src/features/system-settings/footer/`，`web/src/components/layout/components/footer.tsx`，`setting/system_setting/footer.go`，`model/option.go`，`controller/{option,misc}.go`，`router/api-router.go`，`middleware/access_token_routes.go`；增加配置/预览、原子保存 API 与 option:write 路由权限 | 页脚解析/校验/权限/缓存/管理测试，`TestFooterOptionStorageFailureKeepsPublishedValue`、三数据库 `TestFooter` 与真实配置截图 | **保留**现有管理员配置；上游提供等价能力时**迁移适配**，不能丢失保存值或合法开源声明入口 |
| 实际版本与 fork 更新来源 | `web/src/features/system-update/`，版本/状态封装，`controller/misc.go`；展示真实构建来源，避免把官方最新版本误当作本站镜像源码 | 版本解析、状态刷新、镜像 revision 和实际内嵌资产检查 | **保留**可追溯源码；上游统一后**适配**来源配置，不维护一套虚假版本号 |

PR #18 的五项上游更新按原实现接入，其中缓存类别仅展示、不另造结算公式。本轮 PR #19 是 Chat 参数兼容与两段安全政策说明，也没有新增独立页面路由；未来上游新增页面继续保留 TanStack 路由、上游导航与权限入口，随后适配现有共享布局。

## 五、同步、验证与发布门禁

正式发布完成验证后维护固定拉取地址 `ghcr.io/ludafenqi/wuchuang-api:stable`，同时保留完整 SHA 标签及 digest。发布互斥覆盖构建和 stable 推进，推进前再次核对 main 和最新发布运行，并校验已拉取镜像的 revision、运行服务、资源和许可。测试分支只发布独立测试标签。部署脚本先把标签解析为 digest，记录本次内容后重建服务，使用方法见 [部署说明](docs/WUCHUANG-ACTIONS-DEPLOY.md)。

| 机制 | 实际实现与必须保留的保护 | 回归/证据 |
| --- | --- | --- |
| 候选提交前规范化 | `.github/scripts/prepare-upstream-candidate.mjs` 调用 `normalizeLocales`；严格解析全部顶层 locale（含新增语言），拒绝重复/转义别名键；i18n:sync 后键和值完全相同才暂存并提交；失败恢复原文件并 merge --abort | PR #15 已引入；真实临时 Git 回归覆盖无冲突转义规范化、所有语言、幂等、重复输入/输出、新语言语义变化和中断。当前三个脚本 26 项回归通过，无需重复修复 |
| 真正合并冲突 | `merge-upstream-locales.mjs` 仅处理可严格证明的三方键值合并，通过临时 `add-missing-keys.mjs` 写入；非语言或同键语义冲突失败阻断 | PR #18 的七语言/static-keys 是真实冲突，已逐项合并；本轮为干净候选且 web/locale tree 无变化，保留原键值，不放宽合并器、不选择整边 |
| 显式候选与二次检查 | resolved_candidate 必须有双方祖先、准确 pin 和原 UI 政策；保留指定 SHA，不隐式重写；候选在审阅分支先规范化，后续 i18n:sync 必须零差异 | `prepare-upstream-candidate.test.mjs`，七语言严格语义审计和后续 git diff --exit-code 门禁 |
| UI 与后端全套验证 | 两套 CI 保留三个 Go 模块 GOWORK=off vet/build/test、数据库/独立日志/计费/Redis Cluster/race、前端类型/测试/i18n/质量/构建及 86 项真实页面检查 | 新增/改动文件 error 与格式回归为零；保留完整既有 lint/warning 诊断。截图标注实际检出 SHA、场景、宽度、主题；元数据 head 与 PR merge preview 分别记录 |
| GitHub PR 事件批准 | GITHUB_TOKEN 创建或更新 PR 后，GitHub 可能要求维护者选择 Approve workflows to run；用正常运行批准接口补齐，不改仓库安全设置或删检查 | PR #18 的批准与绿灯保留作历史。本轮正常批准 44286047015、44286046817；候选补充后必须按新 SHA 重跑，不能沿用旧 SHA 的绿灯 |
| 固定镜像与实际拉取 | `.github/workflows/wuchuang-publish-ghcr.yml` 只从审查后的准确 main 构建，发布 ghcr.io/ludafenqi/wuchuang-api:sha-完整SHA；记录 registry index/平台摘要和 revision，再按摘要拉取隔离运行与页面验证 | 不能以本地 image ID 或旧镜像代替 registry digest；本轮不额外移动 latest 标签 |

## 油画主题维护

- 默认明暗调色、亚麻纹理、画框边缘和共享组件外观集中在 `web/src/styles/oil-painting.css`，由 `web/src/styles/index.css` 最后引入。既有主题预设和显式字体、圆角、密度选择继续使用原设置入口。
- `web/src/styles/oil-study.webp` 是项目本地的原创油画装饰图，用于首页画框和桌面认证侧栏。它不替换 WuCora logo、favicon、品牌配置或源项目归属。表格行、输入和弹窗使用实色，图表沿用主题色变量。
- 后续同步复核已有 `wucora-*`、`wcai-*` 和共享组件 `data-slot` 挂接点。优先适配选择器和语义变量，保留上游组件行为。在 320、390、1440 像素宽度的明暗模式下检查首页、认证、定价、控制台及管理界面。保留现有功能和品牌门禁，另检查画作本地加载及认证表单键盘顺序。
- 改版前 Git 回退点为 `e6345d826a7f6d7d916aa78edf36cd1f0db521be`，对应此前正式镜像及其固定摘要记录。

## 每轮操作顺序

1. **固定上游版本**：干净隔离分支 fetch，记录 fork base、完整上游 SHA、新增提交、定制交叉点和原工作区哈希；保护所有旧 worktree，不追赶实施中新增的上游批次。
2. **候选合并**：保留上游祖先，候选提交前做语义无损的翻译规范化；真正冲突逐项解决。显式候选先在审阅分支提交规范化结果，后续零差异检查保留。
3. **功能测试和截图核对**：完整门禁在准确新 SHA 上运行，查看新增功能、首页/登录注册/控制台/定价/页脚及三宽度两主题；同时对照当轮 main 与满意 UI 参考。字体/动态数据差异说明来源，不能把截图数量或构建成功当作功能完整。
4. **审阅 PR 并 merge commit 合并**：核对远端 main 和 PR head 无未审阅漂移，先保存不覆盖既有异向引用的 main 回退分支；必要检查通过后正常结束草稿，以 merge commit 合并，不 squash/rebase/force push。核对新 main 的双亲、tree、UI pin，并验证准确新 main。
5. **构建并验证自有固定版本镜像**：从准确 main 发布固定 SHA 标签，记录 registry digest；按摘要实际拉取，在隔离环境核对源码、标签、架构、资产、接口与页面，保留失败诊断和回滚锚点。
6. **对明确目标部署及回滚检查**：先确认真实主机/架构/方式/目录、当前数据与备份、健康检查及回滚方案，再部署准确 digest。目标缺失时先完成代码和镜像交付并索取缺失信息；历史测试机、旧域名或本地 image ID 不能证明生产目标。部署成功独立记录，不能与 PR 合并或镜像发布混称完成。

质量与截图入口保留在当轮 PR/交付报告中。任何源码变化都须重新审阅和验证；既有 55 项工作副本保持原样。
