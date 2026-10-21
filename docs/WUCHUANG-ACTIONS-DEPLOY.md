# 晤创AI（ludafenqi/wuchuang-api）自动同步、人工发布、VPS 回滚操作指南

## 一、目标

1. 每日检查 `QuantumNous/new-api` 的 `main` 分支（UTC 02:17 / 北京时间约 10:17，GitHub 可能延迟）。
2. 不直接修改 Fork 的 `main`：在独立分支尝试合并；冲突立即报错、停止，不强推你的正式分支。
3. 自动运行 Go vet/build/tests 和 Bun typecheck/tests/build；全部通过后才创建或更新一个审核用 Pull Request。
4. 你审查 PR 后**手动合并**，再**手动点击** Actions 构建并推送自己的 GHCR 镜像。
5. VPS **不会**自动部署；由你确认备份、通过单独部署脚本发布，旧镜像保存在本地，支持回滚。

## 二、添加仓库文件

在仓库 `https://github.com/ludafenqi/wuchuang-api` 中提交：

- `.github/workflows/wuchuang-sync-upstream.yml`
- `.github/workflows/wuchuang-publish-ghcr.yml`
- `scripts/wuchuang-deploy.sh`
- `docs/WUCHUANG-ACTIONS-DEPLOY.md`（本文，可选）

推荐：在自己的电脑解压 ZIP，克隆 Fork，复制这四个文件，提交至新分支并创建 PR；审核后合并到 `main`。

```bash
git clone https://github.com/ludafenqi/wuchuang-api.git
cd wuchuang-api
git switch -c chore/wuchuang-actions
# 在此将配置包内的 .github、scripts、docs 文件复制到仓库对应目录
git add .github/workflows/wuchuang-sync-upstream.yml .github/workflows/wuchuang-publish-ghcr.yml scripts/wuchuang-deploy.sh docs/WUCHUANG-ACTIONS-DEPLOY.md
git commit -m 'chore: configure Wuchuang upstream sync and manual GHCR release'
git push -u origin chore/wuchuang-actions
# 然后到 GitHub Pull requests -> Compare & pull request 创建 PR
```

**注意：** 合并自动同步 PR 时选择 **Create a merge commit**（不要 Squash），以保留 upstream/main 的祖先关系，让下次同步准确检测官方更新。

## 三、GitHub 仓库设置

1. `Settings → Actions → General`：确认允许 Actions 运行。Fork 若要求启用，先点击启用。
2. 在 `Workflow permissions`，确认具有可写权限；配置本身已明确声明 `contents:write` 和 `pull-requests:write`，仓库/组织策略仍可能限制。
3. 勾选 `Allow GitHub Actions to create and approve pull requests`（若该选项可用）。不同账号/组织的权限页面可能有所区别。
4. 不要给工作流配置 Docker Hub 上游项目的用户名、令牌；我们使用 GitHub 提供的 `GITHUB_TOKEN` 登录 GHCR，无需把个人 PAT 放到 Actions。
5. 原仓库继承的 `.github/workflows/docker-build.yml` 等工作流以 `calciumion/new-api` 为 Docker Hub 目标，不属于本方案。**不要运行这些官方发布任务，也不要随意创建触发它们的 Git 标签**。可以在 `Actions` 里选择暂时禁用无需使用的上游发布工作流。

## 四、测试每日同步

1. 进入 `Actions`。
2. 选择 **Wuchuang - Daily upstream sync and tests**。
3. 右侧点击 `Run workflow`，分支选择 `main`，然后运行。
4. 如果日志出现 `Official main is already included in fork main`，说明当前没有待同步更新。
5. 如果有更新，将先运行 Go 和前端测试；通过后，在 `Pull requests` 看到 `chore: review New API upstream updates`。
6. 你在 PR 中检查每个文件的差异（特别是自己的 `web/src/...` 前端定制），再手动点击 `Merge pull request`，选择 **Create a merge commit**。
7. 若发生 merge conflict，流程会失败，**绝不覆盖 main**。需要人工处理冲突，通常通过本地 Git 合并并修复；不要使用 `git reset --hard upstream/main` 或 `git push --force origin main`。
8. 测试失败时也不会创建新的待合并 PR；在 Actions 查看失败测试日志。若此前已有 PR，它可能仍保持打开，请以最近一次工作流结果为准。

**GitHub 限制**：本工作流使用 `GITHUB_TOKEN` 创建 PR，而 GitHub 不会因此自动触发其他普通 `pull_request` workflow。因此同步工作流**本身**先进行完整测试，测试通过才推送并生成 PR。后续手动提交的代码仍可使用继承的普通 CI 检查。

## 五、审核后人工发布 GHCR Docker 镜像

1. PR 合并到 `main` 后，进入 `Actions → Wuchuang - Publish GHCR manually`。
2. 点击 `Run workflow`，**只选择 `main`**。
3. 任务会重新运行 Go/Bun 测试，之后使用仓库 Dockerfile 构建 `linux/amd64` 镜像并推送：
   `ghcr.io/ludafenqi/wuchuang-api:sha-<完整 40 位提交 SHA>`。
4. 工作流完成后，在任务的 `Summary` 中复制 `ghcr.io/ludafenqi/wuchuang-api@sha256:...`。**正式部署推荐用 digest**，保证镜像版本准确。
5. 第一次发布后，到 GitHub 个人账户的 `Packages` 中找到 `wuchuang-api`，根据需要将其设置为 Public。GHCR 包可能默认是 Private；如果 Private，VPS 拉取镜像之前需要单独授权 `read:packages` 并执行 `docker login ghcr.io -u ludafenqi`（不要把令牌直接写在命令历史里）。
6. 目前发布配置默认 `linux/amd64`；VPS 执行 `uname -m` 应为 `x86_64`。如果 VPS 为 `aarch64`，先修改发布工作流支持 `linux/arm64`，否则不可直接部署。

构建成功**不会**自动修改服务器。

## 六、VPS 第一次部署准备（只操作现有 New API，不操作 Sub2API）

通过 SSH 登录 Ubuntu VPS。假设已有目录为 `/opt/ai-gateway/new-api`：

```bash
cd /opt/ai-gateway/new-api
pwd
ls -la
docker compose config --services
docker compose ps
uname -m
```

确认显示服务名称为 `new-api`，并且容器正常运行。如果实际 Compose 文件/服务名称不同，请先调整脚本中的 `BASE_DIR` 或 `SERVICE`，不要直接照做。

**重要：部署前先确认数据库、Docker 数据卷已完成可靠备份且可恢复**。本脚本只保留 Docker 应用镜像，不会备份或回滚数据库结构。新版本可能执行数据库迁移，旧镜像未必兼容迁移后的数据库。建议确认你已有的 VPS→NAS 备份任务正在运行，并实际验证 PostgreSQL/SQLite 备份与恢复方法。

将仓库中的 `scripts/wuchuang-deploy.sh` 下载到 VPS；例如当该文件已合并至 `main` 后：

```bash
sudo curl -fL --retry 3 -o /usr/local/sbin/wuchuang-deploy \
  https://raw.githubusercontent.com/ludafenqi/wuchuang-api/main/scripts/wuchuang-deploy.sh
sudo chmod 700 /usr/local/sbin/wuchuang-deploy
bash -n /usr/local/sbin/wuchuang-deploy
```

先阅读这个脚本，再执行发布。推荐日后固定下载经过审核的 Git 提交版本，避免脚本自身发生未审核变化。

部署第一版（把 `<DIGEST>` 替换为 GHCR Summary 中的真实 `sha256` 值）：

```bash
# 仅在数据库备份已经确认且可用后设置 BACKUP_CONFIRMED=YES。
BACKUP_CONFIRMED=YES /usr/local/sbin/wuchuang-deploy deploy \
  'ghcr.io/ludafenqi/wuchuang-api@sha256:<DIGEST>'
```

脚本会自动：

- 为当前容器镜像建立本地备份标签，例如 `wuchuang-new-api:rollback-20261021000000`；
- 拉取指定的新镜像；
- 在原有项目文件夹生成 `compose.wuchuang-image.yml` 叠加文件，**不覆盖**原 Compose 配置；
- 只重建 `new-api` 一个服务，不运行 `down`，不删除数据库、卷或 Sub2API；
- 使用 `https://wcai.113901.xyz/api/status` 检查健康状态，失败尝试恢复旧镜像。

**特别注意：** 后续如果直接运行原来的 `docker compose up -d` 而不附带 `-f compose.wuchuang-image.yml`，原始 Compose 的 `image` 设置可能又恢复官方镜像。建议以后通过该脚本发布，或每次使用**两个** Compose 文件；不要把它当成自动生效的标准 `compose.override.yml`。

## 七、手动回滚

若出现问题，使用先前保存的本地镜像：

```bash
BACKUP_CONFIRMED=YES /usr/local/sbin/wuchuang-deploy rollback
```

再次检查：

```bash
curl -fsS --max-time 15 https://wcai.113901.xyz/api/status
docker compose -f /opt/ai-gateway/new-api/docker-compose.yml ps
```

注意：最后的 `docker compose ps` 命令只是查看容器，不能单独反映脚本叠加的最终镜像；可用 `docker inspect` 确认镜像 ID：

```bash
CID="$(docker compose -f /opt/ai-gateway/new-api/docker-compose.yml ps -q new-api)"
docker inspect -f '{{.Image}} {{.State.Status}}' "$CID"
```

如果已经发生不兼容的数据库迁移，镜像回滚**不等于数据库回滚**，请配合恢复发布前的数据库快照。避免在没有备份的情况下自动降级数据库。

## 八、定制开发与维护提醒

- 自定义修改放在你自己的提交或 PR，永远不要通过硬重置跟上游同步。
- 对官方更新 PR 只在测试通过、确认修改不会覆盖自己品牌和功能后合并。
- 原项目的 AGPLv3 和 `NOTICE` 包含归属和对外提供源代码等要求。保留 `NOTICE`、相关许可文件、贡献者署名及原仓库链接，公众使用的修改版应提供对应源码。
- GHCR 发布流程与 VPS 部署流程分离，有助于避免一次意外提交导致线上立即升级。
