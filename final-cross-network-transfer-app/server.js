const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const multer = require('multer');
const mime = require('mime-types');
const archiver = require('archiver');
const { Server } = require('socket.io');

// ===== 启动诊断日志 =====
console.log('[STARTUP] Node version:', process.version);
console.log('[STARTUP] PORT:', process.env.PORT);
console.log('[STARTUP] NODE_ENV:', process.env.NODE_ENV);
console.log('[STARTUP] CWD:', process.cwd());
console.log('[STARTUP] __dirname:', __dirname);

// 全局错误处理，避免进程静默退出
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('beforeExit', (code) => {
  console.log('[INFO] Process beforeExit with code:', code);
});

const PORT = Number(process.env.PORT || 3000);
const APP_URL = process.env.APP_URL || '';
const STORAGE_ROOT = process.env.STORAGE_ROOT || path.join(__dirname, 'storage');
console.log('[STARTUP] STORAGE_ROOT:', STORAGE_ROOT);
const DATA_DIR = path.join(STORAGE_ROOT, 'data');
const UPLOAD_DIR = path.join(STORAGE_ROOT, 'uploads');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const MAX_FILE_SIZE_MB = Number(process.env.MAX_FILE_SIZE_MB || 50);
const MAX_HISTORY_PER_ROOM = Number(process.env.MAX_HISTORY_PER_ROOM || 200);
const MESSAGE_RETENTION_COUNT = Number(process.env.MESSAGE_RETENTION_COUNT || 5000);
const MAX_TEXT_LENGTH = Number(process.env.MAX_TEXT_LENGTH || 20000);

for (const dir of [STORAGE_ROOT, DATA_DIR, UPLOAD_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
for (const file of [ROOMS_FILE, MESSAGES_FILE]) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, '[]', 'utf8');
  }
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: (MAX_FILE_SIZE_MB + 2) * 1024 * 1024
});

app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(UPLOAD_DIR, {
  setHeaders: (res, filePath) => {
    const contentType = mime.lookup(filePath);
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

function normalizeRoomId(value = '') {
  return String(value).trim().replace(/\s+/g, '-').toLowerCase().slice(0, 64);
}

function normalizeNickname(value = '') {
  return String(value).trim().replace(/\s+/g, ' ').slice(0, 32);
}

function normalizeText(value = '') {
  return String(value ?? '');
}

function sha256(value = '') {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

async function readJson(filePath) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    const data = JSON.parse(raw || '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function writeJson(filePath, data) {
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function getRooms() {
  return readJson(ROOMS_FILE);
}

async function getMessages() {
  return readJson(MESSAGES_FILE);
}

async function saveRooms(rooms) {
  return writeJson(ROOMS_FILE, rooms);
}

async function saveMessages(messages) {
  return writeJson(MESSAGES_FILE, messages);
}

async function ensureRoom(roomId, password = '') {
  const rooms = await getRooms();
  let room = rooms.find((item) => item.roomId === roomId);
  const passwordHash = sha256(password || '');

  if (!room) {
    room = {
      roomId,
      passwordHash,
      createdAt: new Date().toISOString()
    };
    rooms.push(room);
    await saveRooms(rooms);
    return room;
  }

  if (room.passwordHash !== passwordHash) {
    throw new Error('房间密码错误');
  }

  return room;
}

async function listRoomMessages(roomId) {
  const messages = await getMessages();
  return messages
    .filter((item) => item.roomId === roomId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-MAX_HISTORY_PER_ROOM);
}

async function addMessage(message) {
  const messages = await getMessages();
  messages.push(message);
  if (messages.length > MESSAGE_RETENTION_COUNT) {
    messages.splice(0, messages.length - MESSAGE_RETENTION_COUNT);
  }
  await saveMessages(messages);
  return message;
}

function createMessageBase({ roomId, sender }) {
  return {
    id: crypto.randomUUID(),
    roomId,
    sender,
    createdAt: new Date().toISOString()
  };
}

function getPublicFileUrl(filename) {
  const relativeUrl = `/uploads/${encodeURIComponent(filename)}`;
  if (!APP_URL) return relativeUrl;
  return `${APP_URL.replace(/\/$/, '')}${relativeUrl}`;
}

/**
 * 修复中文文件名乱码问题
 * 问题根因：某些HTTP客户端或中间件可能将UTF-8编码的中文文件名错误地按Latin-1解读
 * 这里尝试用Buffer将Latin-1误读的内容转回UTF-8来恢复原始中文
 */
function decodeUploadedFilename(name) {
  if (!name) return 'file';
  
  const original = String(name);
  
  // 如果原字符串本身已包含有效中文字符，保持原样
  if (/[\u4e00-\u9fa5]/.test(original)) {
    return original;
  }
  
  // 尝试用 Latin-1 -> UTF-8 的反向解码来修复乱码
  let decoded = original;
  try {
    decoded = Buffer.from(original, 'latin1').toString('utf8');
  } catch (e) {
    // 解码失败，保持原值
  }
  
  // 判断是否应该使用解码后的结果：
  // 1. 解码后的字符串包含有效的中文字符
  // 2. 原字符串看起来像乱码（不包含中文但解码后变出了中文）
  const hasChinese = /[\u4e00-\u9fa5]/.test(decoded);
  const wasDecoded = decoded !== original;
  
  // 如果解码后包含中文，且原字符串看起来像乱码，使用解码结果
  if (hasChinese && wasDecoded) {
    // 进一步验证：检查原字符串是否包含典型的乱码特征字符
    const hasGarbageChars = /[ÃÅÄÆÈÉËÏ]/.test(original);
    if (hasGarbageChars || !/[\u4e00-\u9fa5]/.test(original)) {
      console.log('[FILENAME] Decoded garbled filename:', original, '->', decoded);
      return decoded;
    }
  }
  
  return original;
}

/**
 * 生成安全的文件名（用于存储），去除不安全字符
 */
function makeSafeFilename(name) {
  const decoded = decodeUploadedFilename(name);
  return String(decoded || 'file')
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 200);
}

/**
 * 获取文件消息（通过 storedName 在历史消息中查找）
 */
async function findFileMessageByStoredName(storedName) {
  const messages = await getMessages();
  return messages.find(m => m.file && m.file.storedName === storedName);
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safeOriginal = makeSafeFilename(file.originalname);
    const uniqueName = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${safeOriginal}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE_MB * 1024 * 1024,
    files: 20  // 最多支持20个文件同时上传
  }
});

// 多文件上传处理器
const uploadMiddleware = upload.array('files', 20);

const onlineUsersByRoom = new Map();

function listOnlineUsers(roomId) {
  const roomUsers = onlineUsersByRoom.get(roomId);
  if (!roomUsers) return [];
  return Array.from(roomUsers.values()).sort((a, b) => a.nickname.localeCompare(b.nickname, 'zh-CN'));
}

function broadcastOnlineUsers(roomId) {
  io.to(roomId).emit('room:users', listOnlineUsers(roomId));
}

function removeSocketFromRoom(socket, options = {}) {
  const { notify = true } = options;
  const roomId = socket.data.roomId;
  const nickname = socket.data.nickname;

  if (!roomId) {
    return;
  }

  socket.leave(roomId);

  if (onlineUsersByRoom.has(roomId)) {
    onlineUsersByRoom.get(roomId).delete(socket.id);
    if (onlineUsersByRoom.get(roomId).size === 0) {
      onlineUsersByRoom.delete(roomId);
    }
  }

  broadcastOnlineUsers(roomId);

  if (notify && nickname) {
    io.to(roomId).emit('system:notice', {
      id: crypto.randomUUID(),
      roomId,
      content: `${nickname} 已离开房间`,
      createdAt: new Date().toISOString()
    });
  }

  socket.data.roomId = undefined;
  socket.data.nickname = undefined;
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    now: new Date().toISOString(),
    storageRoot: STORAGE_ROOT
  });
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const roomId = normalizeRoomId(req.body.roomId);
    const nickname = normalizeNickname(req.body.nickname);
    const password = String(req.body.password || '');

    if (!roomId) {
      return res.status(400).json({ ok: false, message: '缺少房间号' });
    }
    if (!nickname) {
      return res.status(400).json({ ok: false, message: '缺少昵称' });
    }
    if (!req.file) {
      return res.status(400).json({ ok: false, message: '没有上传文件' });
    }

    await ensureRoom(roomId, password);

    // 修复文件名：使用解码后的原始文件名
    const decodedOriginalName = decodeUploadedFilename(req.file.originalname);

    const isImage = /^image\//.test(req.file.mimetype);
    const message = {
      ...createMessageBase({ roomId, sender: { nickname } }),
      type: isImage ? 'image' : 'file',
      file: {
        originalName: decodedOriginalName,
        storedName: req.file.filename,
        mimeType: req.file.mimetype,
        size: req.file.size,
        url: getPublicFileUrl(req.file.filename)
      }
    };

    await addMessage(message);
    io.to(roomId).emit('message:new', message);

    res.json({ ok: true, message });
  } catch (error) {
    res.status(400).json({ ok: false, message: error.message || '上传失败' });
  }
});

/**
 * 多文件上传接口
 * 支持一次上传多个文件，每个文件生成独立消息
 */
app.post('/api/upload/multiple', uploadMiddleware, async (req, res) => {
  try {
    const roomId = normalizeRoomId(req.body.roomId);
    const nickname = normalizeNickname(req.body.nickname);
    const password = String(req.body.password || '');

    if (!roomId) {
      return res.status(400).json({ ok: false, message: '缺少房间号' });
    }
    if (!nickname) {
      return res.status(400).json({ ok: false, message: '缺少昵称' });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ ok: false, message: '没有上传文件' });
    }

    await ensureRoom(roomId, password);

    const results = { success: [], failed: [] };

    for (const file of req.files) {
      try {
        const decodedOriginalName = decodeUploadedFilename(file.originalname);
        const isImage = /^image\//.test(file.mimetype);
        const message = {
          ...createMessageBase({ roomId, sender: { nickname } }),
          type: isImage ? 'image' : 'file',
          file: {
            originalName: decodedOriginalName,
            storedName: file.filename,
            mimeType: file.mimetype,
            size: file.size,
            url: getPublicFileUrl(file.filename)
          }
        };
        await addMessage(message);
        io.to(roomId).emit('message:new', message);
        results.success.push(message);
      } catch (err) {
        results.failed.push({ filename: file.originalname, error: err.message });
      }
    }

    res.json({
      ok: true,
      total: req.files.length,
      successCount: results.success.length,
      failedCount: results.failed.length,
      messages: results.success,
      failed: results.failed
    });
  } catch (error) {
    res.status(400).json({ ok: false, message: error.message || '上传失败' });
  }
});

/**
 * 批量下载接口
 * 将多个文件打包成zip下载
 */
app.post('/api/files/batch-download', async (req, res) => {
  try {
    const { storedNames } = req.body;

    if (!storedNames || !Array.isArray(storedNames) || storedNames.length === 0) {
      return res.status(400).json({ ok: false, message: '请提供要下载的文件列表' });
    }

    // 限制批量下载的文件数量
    if (storedNames.length > 50) {
      return res.status(400).json({ ok: false, message: '一次最多下载50个文件' });
    }

    // 收集文件信息
    const filesToAdd = [];
    const missingFiles = [];

    for (const storedName of storedNames) {
      // 安全检查
      if (!/^[\w.\-()]+$/.test(storedName)) {
        missingFiles.push({ storedName, error: '无效的文件名' });
        continue;
      }

      const filePath = path.join(UPLOAD_DIR, storedName);
      if (!fs.existsSync(filePath)) {
        missingFiles.push({ storedName, error: '文件不存在' });
        continue;
      }

      // 获取原始文件名
      const fileMessage = await findFileMessageByStoredName(storedName);
      const originalName = fileMessage?.file?.originalName || storedName;

      filesToAdd.push({
        storedName,
        originalName,
        filePath
      });
    }

    if (filesToAdd.length === 0) {
      return res.status(400).json({
        ok: false,
        message: '没有可下载的文件',
        missingFiles
      });
    }

    // 生成zip文件名
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const zipFilename = `批量下载_${timestamp}.zip`;

    // 设置响应头
    const safeAsciiName = zipFilename.replace(/[^\x00-\x7F]/g, '_').replace(/["\\]/g, '_');
    const encodedName = encodeURIComponent(zipFilename).replace(/['()]/g, char => `%${char.charCodeAt(0).toString(16)}`);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition',
      `attachment; filename="${safeAsciiName}"; filename*=UTF-8''${encodedName}`
    );
    res.setHeader('Cache-Control', 'private, no-cache');

    // 创建zip归档
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', (err) => {
      console.error('[BATCH DOWNLOAD ERROR]', err);
      if (!res.headersSent) {
        res.status(500).json({ ok: false, message: '打包文件时出错' });
      }
    });

    archive.pipe(res);

    // 添加文件到zip
    for (const fileInfo of filesToAdd) {
      archive.file(fileInfo.filePath, { name: fileInfo.originalName });
    }

    archive.finalize();
  } catch (error) {
    console.error('[BATCH DOWNLOAD ERROR]', error);
    res.status(500).json({ ok: false, message: '批量下载失败' });
  }
});

/**
 * 下载文件接口
 * 支持中文文件名，设置合理的 Content-Disposition
 * 使用 filename* (RFC 5987) 编码以支持 UTF-8 中文文件名
 */
app.get('/api/files/:storedName/download', async (req, res) => {
  try {
    const { storedName } = req.params;
    
    // 安全检查：只允许文件名中的安全字符
    if (!/^[\w.\-()]+$/.test(storedName)) {
      return res.status(400).json({ ok: false, message: '无效的文件名' });
    }

    const filePath = path.join(UPLOAD_DIR, storedName);
    
    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ ok: false, message: '文件不存在' });
    }

    // 尝试从历史消息中找到原始文件名
    const fileMessage = await findFileMessageByStoredName(storedName);
    const originalName = fileMessage?.file?.originalName || storedName;
    const mimeType = fileMessage?.file?.mimeType || mime.lookup(filePath) || 'application/octet-stream';

    // 设置 Content-Type
    res.setHeader('Content-Type', mimeType);

    // 设置 Content-Disposition 以支持下载时使用原始文件名
    // 同时提供 filename（ASCII回退）和 filename*（UTF-8）两种方式
    // filename* 使用 RFC 5987 规范：UTF-8''编码
    const safeAsciiName = originalName
      .replace(/[^\x00-\x7F]/g, '_')  // 非ASCII字符替换为下划线
      .replace(/["\\]/g, '_');        // 去除引号和反斜杠
    
    const encodedName = encodeURIComponent(originalName)
      .replace(/['()]/g, char => `%${char.charCodeAt(0).toString(16)}`);

    res.setHeader('Content-Disposition', 
      `attachment; filename="${safeAsciiName}"; filename*=UTF-8''${encodedName}`
    );

    // 设置缓存控制
    res.setHeader('Cache-Control', 'private, no-cache');

    // 返回文件流
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  } catch (error) {
    console.error('[DOWNLOAD ERROR]', error);
    res.status(500).json({ ok: false, message: '下载失败' });
  }
});

app.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ ok: false, message: `文件超过 ${MAX_FILE_SIZE_MB}MB 限制` });
    }
    return res.status(400).json({ ok: false, message: err.message });
  }
  return next(err);
});

io.on('connection', (socket) => {
  socket.on('room:join', async (payload, callback) => {
    try {
      const roomId = normalizeRoomId(payload?.roomId);
      const nickname = normalizeNickname(payload?.nickname);
      const password = String(payload?.password || '');

      if (!roomId) {
        throw new Error('请输入房间号');
      }
      if (!nickname) {
        throw new Error('请输入昵称');
      }

      if (socket.data.roomId && socket.data.roomId !== roomId) {
        removeSocketFromRoom(socket, { notify: false });
      }

      await ensureRoom(roomId, password);
      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.nickname = nickname;

      if (!onlineUsersByRoom.has(roomId)) {
        onlineUsersByRoom.set(roomId, new Map());
      }
      onlineUsersByRoom.get(roomId).set(socket.id, {
        socketId: socket.id,
        nickname,
        joinedAt: new Date().toISOString()
      });

      const history = await listRoomMessages(roomId);
      callback?.({
        ok: true,
        roomId,
        nickname,
        history,
        users: listOnlineUsers(roomId)
      });
      broadcastOnlineUsers(roomId);

      io.to(roomId).emit('system:notice', {
        id: crypto.randomUUID(),
        roomId,
        content: `${nickname} 已进入房间`,
        createdAt: new Date().toISOString()
      });
    } catch (error) {
      callback?.({ ok: false, message: error.message || '加入房间失败' });
    }
  });

  socket.on('room:leave', (_payload, callback) => {
    removeSocketFromRoom(socket, { notify: true });
    callback?.({ ok: true });
  });

  socket.on('message:text', async (payload, callback) => {
    try {
      const roomId = socket.data.roomId;
      const nickname = socket.data.nickname;
      const text = normalizeText(payload?.text);
      const trimmedText = text.trim();

      if (!roomId || !nickname) {
        throw new Error('你还没有加入房间');
      }
      if (!trimmedText) {
        throw new Error('消息内容不能为空');
      }
      if (trimmedText.length > MAX_TEXT_LENGTH) {
        throw new Error(`文字超过上限，当前最多 ${MAX_TEXT_LENGTH} 个字符`);
      }

      const message = {
        ...createMessageBase({ roomId, sender: { nickname } }),
        type: 'text',
        text: trimmedText
      };
      await addMessage(message);
      io.to(roomId).emit('message:new', message);
      callback?.({ ok: true });
    } catch (error) {
      callback?.({ ok: false, message: error.message || '发送失败' });
    }
  });

  socket.on('disconnect', () => {
    removeSocketFromRoom(socket, { notify: true });
  });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Cross-network transfer app is running on http://0.0.0.0:${PORT}`);
  console.log(`Persistent storage root: ${STORAGE_ROOT}`);
});
