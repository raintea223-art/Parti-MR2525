# NAS 部署指南（局域网协同）

将模板库部署在 NAS 上后，同事通过浏览器访问同一地址即可协同录入、报价、上传 skp。

**示例访问地址：** `http://192.168.1.59:3847`

---

## 前提

| 项目 | 要求 |
|------|------|
| NAS | 支持 Docker（群晖 Container Manager、威联通 Container Station、飞牛、Unraid 等） |
| 网络 | 同事与 NAS 在同一局域网，或已配置 VPN |
| 数据 | `data/` 目录持久化（数据库 + 上传附件） |
| PDF 手册 | 容器内已安装 **Chromium** + 中文字体（模板图册「下载手册」） |

> 当前系统需登录后访问，适合内网使用。勿直接暴露到公网。

---

## 群晖 DS923+ 部署（Container Manager，推荐）

DS923+ 为 x86 架构，直接运行本项目 Docker 镜像，无需额外配置。

### 第一步：上传项目文件

**不要复制 `node_modules` 文件夹**（体积大且会在容器内重新安装）。需要上传的内容：

```
mr2525-template-catalog/
├── Dockerfile
├── docker-compose.yml
├── package.json
├── package-lock.json
├── public/
├── src/
└── data/              ← 若电脑上已有数据，一并上传
    ├── catalog.db
    └── uploads/
```

**上传方式（任选其一）：**

1. **File Station**：在共享文件夹（如 `docker`）新建 `mr2525-template-catalog`，拖入上述文件
2. **Windows 资源管理器**：地址栏输入 `\\192.168.1.59`，登录后复制到 `docker\mr2525-template-catalog`

最终路径示例：`/volume1/docker/mr2525-template-catalog/`

### 第二步：用 Container Manager 创建项目

1. 打开 **Container Manager**（套件中心已安装）
2. 左侧点 **项目** → 右上角 **新增**
3. **项目名称**：`mr2525-template-catalog`
4. **路径**：选刚上传的文件夹（含 `docker-compose.yml` 的目录）
5. 来源选 **使用现有的 docker-compose.yml**
6. 网页设置中确认端口映射为 **3847:3847**
7. 点 **下一步** → **完成** → **构建**（首次约 3–8 分钟，含 Chromium 与中文字体）

构建成功后，项目状态应为 **运行中**，容器名 `mr2525-template-catalog`。

> **模板图册 PDF**：依赖容器内 `/usr/bin/chromium`。若 PDF 下载失败，请重建镜像并确认 `Dockerfile` 使用 `node:22-slim` 且已安装 `chromium`、`fonts-noto-cjk`。

### 第三步：防火墙（若启用了 DSM 防火墙）

**控制面板 → 安全性 → 防火墙 → 编辑规则** → 允许 **本地端口 TCP 3847**。

未启用防火墙可跳过。

### 第四步：访问与发给同事

本机浏览器打开：

```
http://192.168.1.59:3847
```

同事在同一局域网内，用同一地址即可协同使用。

### 第五步：验证

| 检查项 | 预期 |
|--------|------|
| 模板列表 | 能看到已迁移的数据 |
| 新建模板 | 提交后生成编号 |
| 上传 skp | 详情页上传成功 |
| 导出 CSV | 侧边栏可下载 |

### 日常维护（Container Manager 界面）

| 操作 | 路径 |
|------|------|
| 查看日志 | 项目 → 选中项目 → **详情** → **日志** |
| 重启服务 | 项目 → **操作** → **重新启动** |
| 更新代码 | 覆盖 NAS 上文件后 → **构建** → **重新部署** |
| 停止服务 | 项目 → **停止** |

### 备份

在 **Hyper Backup** 或 **Snapshot Replication** 中，定期备份：

```
/volume1/docker/mr2525-template-catalog/data/
```

只需备份 `data/`，代码可随时从 Git/电脑重新上传。

### 群晖常见问题

| 现象 | 处理 |
|------|------|
| 构建失败「permission denied」 | File Station 中右键项目文件夹 → **属性** → **权限**，给当前用户读写 |
| 页面打不开 | Container Manager 确认容器 **运行中**；DSM **控制面板 → 网络** 确认 IP 仍为 192.168.1.59 |
| 保存/上传失败 | 查看容器日志；确认 `data/` 目录存在且可写 |
| 想用 80 端口 | 改 `docker-compose.yml` 为 `"8080:3847"`，访问 `http://192.168.1.59:8080` |

### 账号与权限（与群晖 DSM 账号独立）

模板库使用**应用内登录**，不会自动读取群晖文件夹权限。首次启动会创建管理员（见 `docker-compose.yml` 中的 `ADMIN_USERNAME` / `ADMIN_PASSWORD`）。

| 角色 | 权限 |
|------|------|
| **管理员** | 全部功能 + 单价库 + 用户管理 + 导出 CSV |
| **编辑** | 新建/编辑模板、报价、上传文件、导出 CSV |
| **只读** | 浏览列表与详情，不可修改 |

登录后管理员在 **用户管理** 中为同事创建账号并分配角色。建议部署后立即修改管理员密码。

在 `docker-compose.yml` 中可设置：

```yaml
ADMIN_USERNAME: admin
ADMIN_PASSWORD: 你的强密码
SESSION_SECRET: 随机长字符串
```

---

## 方式一：SSH + Docker Compose（可选）

若已启用 SSH（**控制面板 → 终端机和 SNMP → 启用 SSH**）：

```bash
sudo -i
cd /volume1/docker/mr2525-template-catalog
docker compose up -d --build
```

后续命令：

```bash
docker compose ps          # 状态
docker compose logs -f     # 日志
docker compose up -d --build   # 更新后重建
docker compose down        # 停止
```

---

## 方式二：群晖 Container Manager（图形界面，简要版）

见上文 **「群晖 DS923+ 部署」** 完整步骤。

---

## 方式三：威联通 Container Station

1. 上传项目到共享文件夹
2. Container Station → **创建** → **应用程序** → 从 `docker-compose.yml` 创建
3. 映射端口 `3847:3847`，挂载卷 `./data:/app/data`
4. 启动后访问 `http://192.168.1.59:3847`

---

## 迁移已有数据（从 Windows 电脑）

1. 停止本地 `npm start`
2. 复制整个 `data` 文件夹到 NAS 项目目录（覆盖或合并）
3. 在 NAS 上 `docker compose up -d --build`
4. 打开 NAS 地址，确认模板列表与附件正常

```
data/
├── catalog.db      ← SQLite 数据库
└── uploads/        ← skp、封面、效果图
```

---

## 备份建议

定期备份 NAS 上的 `data/` 目录（Hyper Backup、快照、或手动复制均可）。

---

## 协同使用说明

| 场景 | 说明 |
|------|------|
| 多人同时浏览/编辑不同模板 | 正常 |
| 多人同时改同一模板 | SQLite 单写，后保存者覆盖；建议分工按模板编号 |
| 上传 skp（最大 200MB） | 确保 NAS 磁盘空间充足 |
| 导出飞书 CSV | 侧边栏导出，与本地版相同 |

---

## 故障排查

| 现象 | 处理 |
|------|------|
| 同事打不开页面 | 确认 NAS IP、端口 3847 已放行、容器在运行 |
| 页面能开但保存失败 | `docker compose logs -f` 看报错；检查 `data/` 目录权限 |
| 容器反复重启 | 确认 NAS 架构（x86/arm）与 Node 镜像兼容；群晖较老型号可能是 arm |
| 需要改端口 | 修改 `docker-compose.yml` 中 `ports`，如 `"8080:3847"` |
| 场景手册 PDF 无更新 | 重建/重启容器后，日志应含 `场景手册 PDF: 20260530-handbook-v2`；见 [场景库说明](SCENARIO-LIB-UPDATES.md) §12 |

---

## 后期可选增强

- **固定域名 / 反向代理**：NAS 自带反向代理，可映射为 `http://tpl.local`
- **HTTPS**：内网证书或 Let's Encrypt（需有域名）
- **账号登录**：当前未实现，有公网需求时再开发
