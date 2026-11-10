# WuCora 定制与上游同步维护

本 fork 保留 QuantumNous/new-api 的业务实现与提交祖先。外观集中在主题变量、布局和共享组件；合入上游新增业务时，不用旧 `web/` 覆盖，也不整文件选择 ours/theirs。版权头、LICENSE、作者与许可信息继续保留。

## 固定版本

- 本轮开始的 fork main：`fe24147d2e105f570f0a80e669d708d54a3e7efd`。
- 前次上游：`dd50ee0a567b810ea60e74dcd9ea6a5786b37b91`。
- 本轮固定上游：`bd6bb53019fb7e21804b31ab7365c9b2097f4b6c`；重新获取两个远端后与审查快照相同，没有追加范围。
- 新增四个提交：DeepSeek 高级自定义搜索/抓取路径、OAuth 邀请人持久化、协议文案国际化、`HOST` 监听地址。
- UI 参考：`.github/wucora-ui.json` 的 `uiReference=b6f0b02864fe13cdd30dd8c443e1af1e53646c5b`；`referenceRun`、镜像 digest、`reviewRequired` 均保留。

## 定制清单

审查基线的净差异为 247 个文件（142 个 web、42 个非测试 Go 文件等）。下表按维护责任分组，不将每个文件误算成独立功能。新增上游版本前使用 `git diff --name-status <integratedUpstream>..origin/main` 重新核对。

| 用途 | 主要路径 | 回归保护 | 上游提供替代实现时 |
| --- | --- | --- | --- |
| WuCora 颜色、字体、品牌资源和明暗主题 | `web/src/styles/{theme,cloud,home,index}.css`、`web/src/context/theme-provider.tsx`、`web/public/wucora-logo.png`、`web/src/components/layout/components/system-brand.tsx` | `styles/__tests__/`、`context/__tests__/`、真实浏览器三宽度两主题 | 复用上游主题能力，保留变量值与品牌资源；以同场景截图和对比度测试验收 |
| 首页模型展示、接入说明、登录注册标题 | `web/src/features/home/`、`web/src/features/auth/auth-layout.tsx`、`auth/sign-in/`、`auth/sign-up/` | 首页布局、品牌标题、协议切换和同意状态测试；桌面/移动端截图 | 新功能逻辑采用上游 hooks/API/表单，品牌放在现有布局和 props，避免复制认证流程 |
| 控制台、公共导航、可滚动表格、定价卡片 | `web/src/components/layout/`、`components/data-table/core/data-table-view.tsx`、`features/dashboard/`、`features/pricing/` | 导航与模型卡片测试；真实价格删除/撤销/取消/确认、渠道亲和性操作、溢出检查 | 保留路由权限、查询、业务状态；缩减定制布局差异，使用共享组件扩展 |
| 共享输入、密码显隐、弹窗、主题设置 | `web/src/components/{password-input,config-drawer}.tsx`、`components/ui/` | 密码输入、键盘/弹窗与响应式脚本；真实登录页密码显隐 | 优先上游同等行为；兼容现有调用方并移除重复封装 |
| 可配置页脚、管理员预览、首页开源声明 | `web/src/features/footer/`、`features/system-settings/footer/`、`features/open-source/`、`components/layout/components/footer.tsx`、`setting/system_setting/footer.go`、`model/option.go`、`controller/{option,misc}.go` | 页脚解析/权限/缓存刷新/管理测试、三数据库 `TestFooter`、真实网关页脚设置截图 | 对齐上游配置模型，迁移现有管理员值，保留链接校验、清理和声明可访问性；不得丢弃已保存配置 |
| 系统状态与更新来源显示 | `web/src/lib/{status-query,build-version,build-metadata}.ts`、`stores/system-config-store.ts`、`features/system-update/`、`controller/misc.go` | 状态查询、版本解析、更新检查、页脚缓存刷新测试 | 可由上游统一能力替代，保留 fork 的实际版本/发布来源，移除旧路径前验证缓存失效 |
| 原子订阅退款和结算失败边界 | `model/subscription.go`、`service/quota.go`、`relay/request_billing.go`、`controller/relay.go` | `subscription_refund_test.go`、`relay_panic_test.go`、独立日志库结算三数据库矩阵 | 逐项比对上游不变量：不重复退款、预扣/结算对账、事务失败安全；通过原回归后再删补丁 |
| 流式传输、取消、panic、用量结算 | `relay/helper/{stream_scanner,common}.go`、`relay/common/stream_status.go`、各 handler、OpenAI/Claude/Gemini/xAI 等 adaptor、`logger/panic.go` | 流式/panic/Realtime 测试、race detector、已交付 SSE 三数据库结算 | 保留已发送内容计费边界、上游取消与 goroutine 退出；上游修复须在同样故障注入用例下证明等价 |
| Vertex 凭据缓存、重试请求体、渠道回滚 | `relay/channel/vertex/service_account.go`、`relay/channel/api_request.go`、相关测试 | Vertex race 测试、GetBody 重放测试、渠道创建/回滚三数据库验证 | 上游实现满足失效、并发、独立凭据隔离后再移除补丁 |
| 同步候选和审阅证据 | `.github/scripts/{prepare-upstream-candidate,merge-upstream-locales,upstream-review}.mjs`、两套 CI、`web/scripts/wucora-{quality,browser}.mjs` | 真实临时 Git 仓库测试、重复键/语义变化/异常中断/显式 SHA、质量基线、截图制品 | 保留失败阻断、准确 SHA、人工审阅和 merge ancestry；不能以删除门禁消除失败 |

## 本轮耦合点与验收

无文本冲突的合并也会把 `footer.new\u0061pi.projectAttributionSuffix` 恢复为等价字面键。候选准备现在在 merge commit 前运行 `i18n:sync`：先严格解析所有顶层语言 JSON（包括新增语言），拒绝重复或转义别名键，再核对每个解析键和值完全相同，全部通过后才暂存。失败恢复规范化前的原文件并中止合并。冲突路径仍使用原三方语义合并，不猜测翻译。

显式 `resolved_candidate` 仍须包含双方祖先、准确上游批次和受保护的 UI 元数据；选中后保持其准确 SHA。它不会被自动规范化。后续再次 `i18n:sync` 必须零差异；未规范化的显式候选会在该门禁失败，需要在审阅分支提交修正后重新指定 SHA。

本轮仅复用已有 `LegalConsent`、`TermsFooter`、`Checkbox` 和认证布局；协议语言切换测试同时保护 WuCora 标题与同意状态。上游已有 DeepSeek 路径测试覆盖路由启用与序列化。OAuth 上游回归覆盖有效、缺失、无效邀请码，以及老用户登录不得重新分配邀请人；CI 将其扩展到真实 SQLite、MySQL 8.0.46、PostgreSQL 18.6。浏览器用一次性真实网关验证 `HOST=127.0.0.1` 可访问且其他回环地址拒绝连接。

认证审查依据 [OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)、[Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)、[OAuth2](https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html) 与 ASVS 5.0.0：检查邀请数据不改变认证身份/绑定、不在重新登录时重分配归属、不改变现有 state/会话验证。本轮不是整站 ASVS 合规认证。

## 每轮操作

1. 在干净隔离分支重新 fetch `origin/main` 与 `upstream/main`，记录完整 SHA、新增提交及定制交叉路径。只给确切仓库添加进程级 `safe.directory` 例外。
2. 在工作流手动输入固定 `upstream_sha`。无冲突和可证明等价的语言冲突可自动准备；其他冲突在独立分支逐项修复、提交，并通过 `resolved_candidate` 提交完整准确 SHA。不要复用旧自动化分支作为隐式冲突解决。
3. 运行三个同步脚本测试、二次翻译零差异门禁、Go 根模块及两个独立模块的 vet/build/test、数据库/Redis/race 回归、前端 typecheck/tests/质量门禁/build、真实网关浏览器检查。`GOWORK=off` 用于各 Go 模块。
4. 将运行 URL、被检验的候选完整 SHA、数据库版本、截图和 `result.json` 放入 PR。旧 SHA 的绿灯不算本轮通过。质量门禁允许已记录的上游遗留项，但新增错误、修改文件错误和新增格式问题必须为零。
5. 视觉验收分别检查固定 UI 参考和本轮 main 的截图；记录构建 SHA、视口、主题与场景。现有浏览器脚本保存图像并检查行为，没有自动与 `uiReference` 做像素比较。字体、动态数据和画布图表不同的截图不能当像素基线；功能仍由独立行为检查证明。
6. 所有必要检查通过后人工审阅，以 **merge commit** 合并（不 squash/rebase），保持上游祖先关系。后续正常发布流程以准确提交构建镜像，部署按 digest 单独执行。本任务不包含生产部署。
