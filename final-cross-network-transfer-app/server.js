const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const multer = require('multer');
const mime = require('mime-types');
const { Server } = require('socket.io');

// 全局错误处理，避免进程静默退出
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

const PORT = Number(process.env.PORT || 3000);
const APP_URL = process.env.APP_URL || '';
const STORAGE_ROOT = process.env.STORAGE_ROOT || path.join(__dirname, 'storage');
const DATA_DIR = path.join(STORAGE_ROOT, 'data');
const UPLOAD_DIR = path.join(STORAGE_ROOT, 'uploads');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const MAX_FILE_SIZE_MB = Number(process.env.MAX_FILE_SIZE_MB || 50);
const MAX_HISTORY_PER_ROOM = Number(process.env.MAX_HISTORY_PER_ROOM || 200);
const MESSAGE_RETENTION_COUNT = Number(process.env.MESSAGE_RETENTION_COUNT || 5000);

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
  return String(value).trim().slice(0, 4000);
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

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safeOriginal = String(file.originalname || 'file').replace(/[^\w.\-()一-龥]/g, '_');
    const uniqueName = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${safeOriginal}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE_MB * 1024 * 1024,
    files: 1
  }
});

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

    const isImage = /^image\//.test(req.file.mimetype);
    const message = {
      ...createMessageBase({ roomId, sender: { nickname } }),
      type: isImage ? 'image' : 'file',
      file: {
        originalName: req.file.originalname,
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

      if (!roomId || !nickname) {
        throw new Error('你还没有加入房间');
      }
      if (!text) {
        throw new Error('消息内容不能为空');
      }

      const message = {
        ...createMessageBase({ roomId, sender: { nickname } }),
        type: 'text',
        text
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
