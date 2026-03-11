# EKS Dashboard 生产环境部署指南

本文档旨在指导您如何在生产环境中部署 EKS Dashboard 应用。该应用包含一个后端服务和一个前端服务。

## 1. 预备环境

在开始之前，请确保您的服务器上已安装以下软件：

- Git
- Node.js (推荐 LTS 版本)
- NPM 或 Yarn
- [Nginx](https://nginx.org/en/docs/install.html) (推荐)
- [PM2](https://pm2.keymetrics.io/docs/usage/quick-start/) (推荐, 用于管理 Node.js 进程)

## 2. 获取代码

首先，从 Git 仓库克隆项目代码到您的服务器。

```bash
git clone <your-repository-url>
cd <project-folder>
```

项目包含两个主要部分：

- `eks-dashboard-backend`: 后端服务 (当前目录)
- `eks-dashboard-frontend`: 前端服务 (假设与后端服务在同一父目录下)

## 3. 环境配置

在构建和启动服务之前，需要配置必要的环境与后端/前端连接信息。

### 3.1. 后端服务 (`eks-dashboard-backend`)

后端服务需要两类配置：

- `.env`：用于数据库连接与部分全局参数。
- `environments.json`：用于定义各个环境的 AWS/K8s/Redis/DB 等详细信息（`environmentId` 与 AWS 凭证/profile 的对应关系就在这里）。

1. 在 `eks-dashboard-backend` 根目录下创建一个名为 `.env` 的文件：

   ```bash
   # 确保您在 eks-dashboard-backend 目录下
   touch .env
   ```

2. 编辑 `.env` 文件，并填入以下内容。请根据您的实际环境替换其中的值。

   ```dotenv
   # .env

   DB_HOST=1.2.3.4
   DB_PORT=3306
   DB_USER=root
   DB_PASSWORD=password
   DB_DATABASE=spot
   VLINK_API_URL=https://vlink2-yyds.vlink1tenant.shop
   ```

3. 在 `eks-dashboard-backend` 根目录创建 `environments.json`（可参考 `environments.json-example`）。
   - `id` 即前端请求时使用的 `environmentId`
   - AWS 凭证可以用 `aws_access_key_id`/`aws_secret_access_key`，或用 `aws_profile`
   - 如果两者都不配置，会走默认 AWS 凭证链

#### 环境配置来源与凭证逻辑（重要）

- **配置来源优先级**：若数据库存在 `environments_config` 表且有数据，则以数据库为准；否则回退到 `environments.json` 文件。
- **AWS 凭证选择**：
  1) 若存在 `aws_access_key_id` + `aws_secret_access_key`，优先使用 AK/SK  
  2) 否则若存在 `aws_profile`，使用服务器本地 AWS profile（`~/.aws/credentials`）  
  3) 两者都没有，则走默认 AWS 凭证链（如 EC2 Role / IRSA）
- **Kube Context**：访问集群仍依赖 `kubeContext`，即使 AK/SK 正确也需要配置该字段。

#### 数据库表与字段概览（便于运维/AI 快速理解）

以下为当前项目已使用的核心表（MySQL 5.7）与用途概览，字段以实际表为准：

- `environments_config`：环境配置主表（AWS/K8s/Redis/DB/JumpServer/Alerts 等 JSON 配置）
- `environments_meta`：环境元信息（`environment_id`/`name`）
- `tenants`：租户信息（`environment_id` + `tenant_id` + `name`）
- `environment_alerts`：环境级告警配置（阈值/冷却/成功码等）
- `site_monitors`：站点监控配置（host/port/is_https/acceptable_status_codes 等）
- `site_monitor_checks`：站点监控检查结果（成功/失败次数与最近状态）
- `tenant_sources`：租户来源或关联信息（用于业务数据聚合/查询）

如需迁移或新增字段，请同步更新 SQL 脚本与相关文档，避免线上与文档不一致。

### 3.2. 前端服务 (`eks-dashboard-frontend`)

前端应用需要知道后端 API 与 WebSocket 的地址。通过以下两种方式配置：

- `public/environment.json`：用于 API 基地址（`API_BASE_URL`）。
- `.env`（可选）：用于 `VITE_SOCKET_URL`、`VITE_API_BASE_URL` 等（仅 `VITE_` 前缀会注入前端）。

1. 在前端项目的 `public` 目录下创建一个名为 `environment.json` 的文件 (如果您的项目结构不同，请放在相应的静态资源目录下)。

   ```bash
   # 假设前端目录与后端目录同级
   cd ../eks-dashboard-frontend
   mkdir -p public
   touch public/environment.json
   ```

2. 编辑 `public/environment.json` 文件，并填入后端服务的访问地址。

   ```json
   {
     "API_BASE_URL": "http://<your-server-ip-or-domain>/api"
   }
   ```

   **注意**: 这里的 `API_BASE_URL` 通常指向 Nginx 反向代理的地址，而不是直接指向后端端口。我们将在 Nginx 配置部分详细说明。

## 4. 构建与启动 (最佳实践)

### 4.1. 后端服务

推荐使用 `PM2` 来管理后端 Node.js 进程，它可以保证服务在后台持续运行，并在崩溃时自动重启。

1. **安装依赖并构建**

   在生产服务器上直接构建应用，需要先安装完整的依赖（包括构建所需的 `devDependencies`）。

   ````bash
   # 切换到后端项目目录

   cd /path/to/your/project/eks-dashboard-backend

   # 安装所有依赖

   npm install

   # 构建应用
   npm run build    ```

   ````

2. **(可选) 清理开发依赖**

   为了节省磁盘空间并保持生产环境整洁，可以在构建完成后移除开发依赖。

   ```bash
   npm prune --production
   ```

3. **使用 PM2 启动服务**

   ```bash
   # 全局安装 PM2 (如果尚未安装)
   # npm install pm2 -g

   # 启动服务
   pm2 start dist/main.js --name eks-dashboard-backend
   ```

   您可以使用 `pm2 list` 查看服务状态，`pm2 logs eks-dashboard-backend` 查看日志。

### 4.2. 前端服务

前端应用需要被构建成静态文件（HTML, CSS, JS），然后由 Nginx 托管。

1. **安装依赖**

   ```bash
   cd /path/to/your/project/eks-dashboard-frontend
   npm install
   ```

2. **构建应用**

   ```bash
   npm run build
   ```

   此命令通常会在 `build` 或 `dist` 目录下生成静态文件。请根据您项目的实际情况确认输出目录。

## 5. 配置 Nginx (托管前端并代理后端)

Nginx 在这里扮演两个角色：

1. 作为静态文件服务器，托管前端构建出的文件。
2. 作为反向代理，将前端的 API 请求 (`/api`) 转发给后端服务，避免跨域问题。

以下是一个 Nginx 的配置示例。您可以在 `/etc/nginx/sites-available/` 目录下创建一个新的配置文件（例如 `eks-dashboard`），然后链接到 `sites-enabled`。

```nginx
# /etc/nginx/sites-available/eks-dashboard

server {
    listen 80;
    server_name your-server-ip-or-domain; # 替换为您的服务器 IP 或域名

    # 前端静态文件根目录 (请使用您前端项目构建后输出的绝对路径)
    root /path/to/your/project/eks-dashboard-frontend/build;
    index index.html index.htm;

    # 处理前端路由（对于使用 History API 的单页应用）
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 反向代理后端 API 请求 (所有 /api 开头的请求都会被转发到后端服务)
    location /api/ {
        proxy_pass http://localhost:3000; # 后端服务地址 (注意：去掉了末尾的斜杠)
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**配置步骤**:

1. 将上述配置保存到 `/etc/nginx/sites-available/eks-dashboard`。
2. 创建软链接启用该配置: `sudo ln -s /etc/nginx/sites-available/eks-dashboard /etc/nginx/sites-enabled/`
3. 测试 Nginx 配置是否正确: `sudo nginx -t`
4. 如果测试通过，重新加载 Nginx 服务: `sudo systemctl reload nginx`

## 6. 从外部访问

完成以上所有步骤后，您的 EKS Dashboard 应该已经成功部署。

您可以通过浏览器访问您在 Nginx 中配置的服务器 IP 或域名，来打开网站页面。

`http://your-server-ip-or-domain`

前端页面会加载，并且所有对后端 API 的请求都会通过 Nginx 自动转发到正在运行的后端服务。
