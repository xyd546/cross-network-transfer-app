# 02 · Render 部署清单

## 目标

把本项目部署成一个公网网址，让任意电脑都可以只靠浏览器访问。

---

## 1. 部署前确认

- 已推送到 GitHub
- 仓库根目录有 `package.json`
- 仓库根目录有 `render.yaml`
- 本地 `npm start` 能正常运行

---

## 2. 创建 Web Service

在 Render Dashboard 中：

1. 点击 **New**
2. 选择 **Web Service**
3. 连接 GitHub
4. 选择当前仓库

---

## 3. 如果你手动填表，建议如下

- **Name**: `cross-network-transfer-app`
- **Branch**: `main`
- **Runtime**: Node
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Health Check Path**: `/api/health`

---

## 4. 环境变量

至少添加：

```text
STORAGE_ROOT=/opt/render/project/src/storage
MAX_FILE_SIZE_MB=50
MAX_HISTORY_PER_ROOM=200
MESSAGE_RETENTION_COUNT=5000
```

如果你后面绑定了正式域名，也可以再加：

```text
APP_URL=https://你的正式域名
```

---

## 5. 持久化磁盘

正式版建议开启。

- **Mount Path**: `/opt/render/project/src/storage`
- **Size**: 先从 `1 GB` 开始

注意：

- 没有磁盘时，文件和历史消息会在重启或重新部署后丢失
- 开启磁盘后，服务重新部署时会有几秒不可用，这是正常现象

---

## 6. 部署完成后的验证

1. 打开 Render 给你的公网链接
2. 创建房间
3. 复制邀请链接给另一台电脑
4. 分别测试：
   - 文字实时同步
   - 图片实时显示
   - 文件上传与下载
   - 刷新后历史是否仍存在

---

## 7. 后续更新方式

以后只要：

```bash
git add .
git commit -m "feat: xxx"
git push
```

如果 Render 绑定的是 `main`，就会自动重新部署。
