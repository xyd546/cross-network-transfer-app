# 错误记忆库 - 跨网传递项目

本文档记录已踩过的坑、原因、正确处理方式和避免方法。

---

## 1. Render Early Exit - 应用提前退出

### 现象
```
The application exited early
```
服务启动后立即退出，Render 日志没有明确错误。

### 根因
1. render.yaml 缺少 PORT 环境变量配置
2. 缺少全局异常处理器，导致静默退出
3. Node 版本不兼容（使用了非 LTS 版本）

### 正确处理方式
1. 在 render.yaml 中明确添加 PORT=10000
2. 添加 NODE_ENV=production
3. 在 server.js 中添加：
   ```javascript
   process.on('uncaughtException', (err) => {
     console.error('[FATAL]', err.message, err.stack);
     process.exit(1);
   });
   process.on('unhandledRejection', (reason) => {
     console.error('[FATAL]', reason);
   });
   ```
4. 设置 nodeVersion: "20" 使用 LTS 版本

### 以后如何避免
- 部署前本地用 NODE_ENV=production PORT=10000 模拟生产环境
- 添加启动诊断日志输出关键配置
- render.yaml 配置要完整，不能依赖 Render 默认值

### 当前状态
✅ 已解决

---

## 2. 文字消息静默截断

### 现象
用户输入超过 4000 字符的消息被静默截断，用户不知情。

### 根因
`normalizeText` 函数中使用了 `slice(0, 4000)` 无声截断。

### 正确处理方式
1. normalizeText 只做 String 转换，不截断
2. 在业务逻辑中判断长度
3. 超过限制返回明确错误消息：
   ```javascript
   if (text.length > MAX_TEXT_LENGTH) {
     throw new Error(`文字超过上限，当前最多 ${MAX_TEXT_LENGTH} 个字符`);
   }
   ```

### 以后如何避免
- 不在 normalize 函数中做业务逻辑
- 任何限制都要有明确的用户反馈
- 前端也要做同样的校验

### 当前状态
✅ 已解决

---

## 3. Windows PowerShell 环境变量设置

### 现象
```
PORT=10000 : 无法将"PORT=10000"项识别为...
```
命令格式错误导致命令无法执行。

### 根因
在 PowerShell 中使用了 CMD 风格的命令。

### 正确处理方式
PowerShell 中设置环境变量：
```powershell
$env:PORT=10000
$env:NODE_ENV="production"
node server.js
```

### 以后如何避免
- 确认当前终端类型
- Windows 11 默认 PowerShell
- 使用正确的 PowerShell 语法

### 当前状态
✅ 已解决

---

## 4. Git 分支与提交规范

### 现象
- 直接 push 到 main，没有 PR 流程
- commit message 不清晰

### 根因
缺乏 Git 工作流规范。

### 正确处理方式
1. 功能开发使用 feature 分支
2. 修复使用 fix 分支
3. 分支命名：`feature/功能名`、`fix/问题名`
4. commit message 格式：
   ```
   feat: 新功能描述
   fix: 修复描述
   docs: 文档更新
   ```

### 以后如何避免
- 遵循 .clinerules 中的 Git 工作流规则
- 功能开发前先创建分支

### 当前状态
✅ 已规范

---

## 5. 剪贴板粘贴需求未落地被误以为已有

### 现象
在讨论中提到"剪贴板粘贴"，但代码中未实现。

### 根因
功能讨论和代码实现脱节。

### 正确处理方式
1. 新功能讨论后立即检查代码状态
2. 与代码交叉验证，不只依赖记忆
3. 明确区分"已计划"和"已实现"

### 以后如何避免
- 每次新会话先核对代码状态
- 记忆文件要标注"已验证"和"待实现"

### 当前状态
✅ 已解决

---

## 6. Render Health Check 失败

### 现象
Render 显示 Health Check 失败，服务状态异常。

### 根因
服务端 `/api/health` 路由未正确实现或端口绑定问题。

### 正确处理方式
1. 确保 server.js 中有 `/api/health` 路由
2. 确认监听正确端口（process.env.PORT）
3. 确认监听 0.0.0.0（不是 localhost）

### 以后如何避免
- 部署后检查 /api/health 是否正常
- 本地用 health check 工具测试

### 当前状态
✅ 已解决

---

## 7. 单文件上传限制

### 现象
无法一次上传多个文件，每次只能上传一个。

### 根因
1. multer 配置 `limits.files: 1` 限制了最多1个文件
2. 使用 `upload.single('file')` 只接收单个文件
3. 前端 `state.selectedFile` 是单个值而非数组
4. file input change 事件只取 `files[0]`

### 正确处理方式
1. 后端：
   ```javascript
   const upload = multer({
     storage,
     limits: { files: 20, fileSize: MAX_FILE_SIZE }
   });
   // 多文件上传路由
   app.post('/api/upload/multiple', upload.array('files', 20), (req, res) => {
     // 处理多个文件
   });
   ```
2. 前端：
   - `state.selectedFiles` 改为数组
   - file input 添加 `multiple` 属性
   - 拖拽处理 `files` 数组

### 以后如何避免
- 明确业务需求是单文件还是多文件
- 多文件使用 `upload.array()` 而非 `upload.single()`

### 当前状态
✅ 已解决

---

## 8. 中文文件名乱码

### 现象
上传中文文件名的文件后，下载时文件名变成乱码。

### 根因
某些 HTTP 客户端或浏览器在上传文件时，将 UTF-8 编码的中文文件名错误地按 Latin-1 解读。

### 正确处理方式
服务端使用反向解码恢复原始中文：
```javascript
// 恢复被错误解读的中文文件名
const original = Buffer.from(file.originalname, 'latin1').toString('utf8');
```

### 以后如何避免
- 文件名处理时考虑编码问题
- 下载时使用 RFC 5987 `filename*` 编码支持中文

### 当前状态
✅ 已解决

---

## 9. 批量下载未实现

### 现象
需要下载多个文件时，只能逐个下载，很不方便。

### 根因
没有批量下载功能接口。

### 正确处理方式
1. 后端使用 archiver 库打包：
   ```javascript
   const archiver = require('archiver');
   app.post('/api/files/batch-download', (req, res) => {
     const { storedNames } = req.body;
     const archive = archiver('zip');
     // 添加文件到 archive
     archive.pipe(res);
     storedNames.forEach(name => {
       archive.file(filePath, { name: originalName });
     });
     archive.finalize();
   });
   ```
2. 前端：
   - 文件消息卡片添加 checkbox 复选框
   - 维护选中文件 Set
   - 批量下载按钮 POST 到接口获取 zip

### 以后如何避免
- 评估用户常见操作场景
- 提供便捷的批量操作功能

### 当前状态
✅ 已解决

---

## 10. 错误记忆模板

如果遇到新错误，按以下格式记录：

```markdown
## 错误标题
### 现象
[具体报错信息或行为]

### 根因
[为什么会发生]

### 正确处理方式
[如何修复]

### 以后如何避免
[预防措施]

### 当前状态
已解决 / 待确认 / 仅适用于某阶段
```

---

## 维护说明

- 每次遇到新错误并解决后，在此文件追加记录
- 如果某个错误再次出现，检查是否按正确方式处理
- 定期整理，删除已过时的错误记录
- 与 project_status.md 保持一致

---

更新时间: 2026-04-09
