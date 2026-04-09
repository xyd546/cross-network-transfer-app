# 跨网传递网页工程（GitHub + Render 最终版）

这是一个可直接继续开发、可接入 GitHub 做版本管理、也可部署到 Render 的完整 Node.js 工程。

它的目标非常明确：**在不同网络、不同电脑之间，通过同一个网页链接，实时传递文字、图片和普通文件。**

---

## 1. 核心功能

- 房间机制：房间号 + 房间密码
- 实时文字同步
- 图片上传后实时预览
- 普通文件上传后可直接下载
- 在线用户列表
- 邀请链接一键复制
- 浏览器端零安装，最终用户只需要打开链接
- 支持 GitHub 版本管理
- 支持 Render 云部署
- 支持持久化磁盘保存历史消息与上传文件
- **剪贴板粘贴**：支持 Ctrl+V / Cmd+V 直接粘贴图片或文字
- **快捷发送**：支持 Ctrl+Enter / Cmd+Enter 发送消息
- **可配置文字长度**：通过 MAX_TEXT_LENGTH 环境变量控制（默认 20000 字符）
- **中文文件名支持**：上传和下载中文文件名时会自动处理编码问题，支持 UTF-8 中文文件名
- **多文件上传**：支持一次选择/拖拽多个文件上传
- **批量下载**：勾选多个文件后，可一键打包下载为 zip

---

## 2. 目录结构

```text
cross-network-transfer-app/
├─ public/                 # 前端静态页面
├─ storage/                # 运行时数据目录（本地开发用）
│  ├─ data/
│  │  ├─ rooms.json
│  │  └─ messages.json
│  └─ uploads/
├─ docs/                   # 操作文档
├─ server.js               # Node.js 服务端入口
├─ package.json
├─ package-lock.json
├─ .gitignore
├─ .env.example
├─ render.yaml             # Render Blueprint
├─ Dockerfile
└─ README.md
```

> 正式部署到 Render 时，建议把 `STORAGE_ROOT` 指向 `/opt/render/project/src/storage`，并挂载持久化磁盘到同一路径。

---

## 3. 本地启动

### 3.1 安装依赖

```bash
npm install
```

### 3.2 启动项目

```bash
npm start
```

### 3.3 浏览器访问

```text
http://localhost:3000
```

---

## 4. 环境变量

参考 `.env.example`：

```env
PORT=3000
APP_URL=
STORAGE_ROOT=./storage
MAX_FILE_SIZE_MB=50
MAX_HISTORY_PER_ROOM=200
MESSAGE_RETENTION_COUNT=5000
MAX_TEXT_LENGTH=20000
```

### 字段说明

- `PORT`：服务端口
- `APP_URL`：可选，部署后若需要生成绝对文件地址可填写公网域名
- `STORAGE_ROOT`：统一存储根目录
- `MAX_FILE_SIZE_MB`：单文件上传大小限制
- `MAX_HISTORY_PER_ROOM`：单房间读取的历史消息条数
- `MESSAGE_RETENTION_COUNT`：全局总消息保留上限
- `MAX_TEXT_LENGTH`：单条文字消息的最大字符数（默认 20000）

### 本地测试步骤

1. 安装依赖：`npm install`
2. 启动服务：`npm start`
3. 浏览器打开 `http://localhost:3000`
4. 测试场景：
   - 正常发送短文字
   - 发送接近 20000 字符的长文字
   - 发送超过 20000 字符的文字（应被阻止）
   - Ctrl+V 粘贴图片
   - Ctrl+V 粘贴文字（在非输入框区域）
   - Ctrl+Enter / Cmd+Enter 发送
   - **上传中文文件名文件**（如：测试文档_中文名.zip）
   - **下载中文文件名文件**，验证保存文件名是否正确
   - **多文件上传**：一次选择多个文件上传
   - **批量下载**：勾选多个文件后点击"批量下载"按钮

---

## 5. API 接口说明

### 5.1 单文件上传
- `POST /api/upload`
- 兼容旧版单文件上传

### 5.2 多文件上传
- `POST /api/upload/multiple`
- 一次上传多个文件，每个文件生成独立消息
- 返回：`{ ok, total, successCount, failedCount, messages, failed }`

### 5.3 单文件下载
- `GET /api/files/:storedName/download`
- 支持中文文件名，使用 RFC 5987 `filename*` 编码

### 5.4 批量下载
- `POST /api/files/batch-download`
- 请求体：`{ storedNames: ["name1", "name2", ...] }`
- 返回：zip 压缩包，内含所有选中的文件，文件名保持原始中文名
- 限制：一次最多下载 50 个文件

### 5.5 健康检查
- `GET /api/health`

---

## 6. 推荐 GitHub 工作流

### 初次上传

```bash
git init
git add .
git commit -m "init: first deployable version"
git branch -M main
git remote add origin 你的仓库地址
git push -u origin main
```

### 后续开发建议

- `main`：稳定、可部署分支
- `dev`：日常开发分支
- `feature/*`：功能分支
- `hotfix/*`：线上修复分支

建议新功能流程：

```bash
git checkout -b feature/your-feature-name
# 改代码
git add .
git commit -m "feat: your feature"
git push --set-upstream origin feature/your-feature-name
```

然后发 Pull Request，审查后再合并到 `main`。

---

## 7. Render 部署建议

### 先做测试版

- 先确认本地可运行
- 再上传到 GitHub
- 再把 GitHub 仓库连到 Render

### 正式版一定要做

- 使用 **Web Service**（不是 Static Site）
- 使用 **persistent disk**
- 持久化路径挂到 `/opt/render/project/src/storage`
- 环境变量 `STORAGE_ROOT=/opt/render/project/src/storage`

仓库根目录已经附带 `render.yaml`，可直接作为 Blueprint 使用。

---

## 8. 当前默认安全处理

这个项目没有把安全做得特别重，但已经做了适合当前阶段的默认控制：

- 关闭 `X-Powered-By`
- 增加基础安全响应头
- 房间密码使用 SHA-256 哈希保存
- 上传文件大小限制
- 文件名基础净化
- 统一持久化目录，避免部署时数据路径混乱
- 前端断线后会自动尝试重连房间

> 这是一个适合个人/小团队使用的轻量工程，不是面向大规模公网匿名用户的重安全系统。

---

## 9. 你接下来最推荐的动作

1. 先本地启动一次
2. 确认文字/图片/文件都正常
3. 测试多文件上传和批量下载
4. 推到 GitHub 私有仓库
5. 在 Render 上按 `docs/02-Render部署清单.md` 部署
6. 部署后用两台不同网络电脑实测

---

## 10. 文档入口

- `docs/01-GitHub版本管理清单.md`
- `docs/02-Render部署清单.md`
- `docs/03-上线验收清单.md`
