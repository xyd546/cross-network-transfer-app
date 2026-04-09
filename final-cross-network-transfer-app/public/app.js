const socket = io();

// 可配置的最大文字长度（与服务端 MAX_TEXT_LENGTH 保持一致）
const MAX_TEXT_LENGTH = 20000;

const state = {
  roomId: '',
  nickname: '',
  password: '',
  joined: false,
  selectedFile: null,
  inviteHashLoaded: false,
  joining: false
};

const els = {
  joinModal: document.getElementById('joinModal'),
  joinForm: document.getElementById('joinForm'),
  joinHelperText: document.getElementById('joinHelperText'),
  nicknameInput: document.getElementById('nicknameInput'),
  roomInput: document.getElementById('roomInput'),
  passwordInput: document.getElementById('passwordInput'),
  rejoinBtn: document.getElementById('rejoinBtn'),
  copyInviteBtn: document.getElementById('copyInviteBtn'),
  inviteLinkBox: document.getElementById('inviteLinkBox'),
  roomDisplay: document.getElementById('roomDisplay'),
  nicknameDisplay: document.getElementById('nicknameDisplay'),
  connectionBadge: document.getElementById('connectionBadge'),
  messageList: document.getElementById('messageList'),
  messageInput: document.getElementById('messageInput'),
  charCount: document.getElementById('charCount'),
  sendBtn: document.getElementById('sendBtn'),
  clearComposerBtn: document.getElementById('clearComposerBtn'),
  fileInput: document.getElementById('fileInput'),
  fileNameHint: document.getElementById('fileNameHint'),
  uploadBtn: document.getElementById('uploadBtn'),
  statusBar: document.getElementById('statusBar'),
  userList: document.getElementById('userList'),
  userCount: document.getElementById('userCount'),
  dropZone: document.getElementById('dropZone')
};

function generateDefaultNickname() {
  const stored = localStorage.getItem('transfer_default_nickname');
  if (stored) return stored;
  const value = `设备-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  localStorage.setItem('transfer_default_nickname', value);
  return value;
}

function parseInviteHash() {
  const hash = (location.hash || '').replace(/^#/, '');
  const params = new URLSearchParams(hash);
  return {
    roomId: params.get('room') || '',
    password: params.get('password') || ''
  };
}

function buildInviteUrl(roomId, password) {
  const hash = new URLSearchParams();
  hash.set('room', roomId || '');
  if (password) hash.set('password', password);
  return `${location.origin}${location.pathname}#${hash.toString()}`;
}

function saveSession() {
  localStorage.setItem('transfer_app_session', JSON.stringify({
    nickname: state.nickname,
    roomId: state.roomId,
    password: state.password
  }));
}

function loadSession() {
  try {
    const raw = localStorage.getItem('transfer_app_session');
    if (!raw) return;
    const data = JSON.parse(raw);
    els.nicknameInput.value = data.nickname || generateDefaultNickname();
    els.roomInput.value = data.roomId || '';
    els.passwordInput.value = data.password || '';
  } catch {
    els.nicknameInput.value = generateDefaultNickname();
  }
}

function applyInviteHashToForm() {
  const invite = parseInviteHash();
  if (!invite.roomId) return false;
  state.inviteHashLoaded = true;
  els.roomInput.value = invite.roomId;
  els.passwordInput.value = invite.password;
  if (!els.nicknameInput.value.trim()) {
    els.nicknameInput.value = generateDefaultNickname();
  }
  els.joinHelperText.textContent = '你是通过邀请链接进入的，房间信息已自动带入；直接点击进入即可。';
  return true;
}

function setStatus(text, tone = 'normal') {
  els.statusBar.textContent = text;
  els.statusBar.style.color = tone === 'error' ? '#ff9b9b' : tone === 'success' ? '#9ef4ce' : '';
}

function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(str = '') {
  return str
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;');
}

function resetMessageList() {
  els.messageList.innerHTML = `
    <div class="empty-state">
      <h3>还没有消息</h3>
      <p>加入房间后，在这里实时查看文字、图片和文件。</p>
    </div>
  `;
}

function removeEmptyState() {
  const emptyNode = els.messageList.querySelector('.empty-state');
  if (emptyNode) emptyNode.remove();
}

function renderUsers(users = []) {
  els.userCount.textContent = String(users.length);
  if (!users.length) {
    els.userList.innerHTML = '<div class="empty-state-small">当前无人在线</div>';
    return;
  }

  els.userList.innerHTML = users.map((user) => {
    const first = (user.nickname || '?').slice(0, 1).toUpperCase();
    return `
      <div class="user-chip">
        <div class="user-avatar">${escapeHtml(first)}</div>
        <div>
          <strong>${escapeHtml(user.nickname || '未命名用户')}</strong>
        </div>
      </div>
    `;
  }).join('');
}

function copyText(text) {
  navigator.clipboard.writeText(text)
    .then(() => setStatus('已复制到剪贴板', 'success'))
    .catch(() => setStatus('复制失败，请手动复制', 'error'));
}

function refreshInviteBox() {
  if (!state.joined || !state.roomId) {
    els.inviteLinkBox.textContent = '进入房间后可一键复制邀请链接';
    els.inviteLinkBox.classList.add('empty');
    return;
  }
  const inviteUrl = buildInviteUrl(state.roomId, state.password);
  els.inviteLinkBox.textContent = inviteUrl;
  els.inviteLinkBox.classList.remove('empty');
}

function createTextMessageNode(message) {
  const isSelf = message.sender?.nickname === state.nickname;
  const wrapper = document.createElement('div');
  wrapper.className = `message-row ${isSelf ? 'self' : 'other'}`;
  wrapper.innerHTML = `
    <div class="message-bubble">
      <div class="message-meta">
        <strong>${escapeHtml(message.sender?.nickname || '匿名用户')}</strong>
        <span>${formatTime(message.createdAt)}</span>
      </div>
      <div class="message-text">${escapeHtml(message.text || '')}</div>
      <div class="message-actions">
        <button class="mini-btn">复制文字</button>
      </div>
    </div>
  `;
  wrapper.querySelector('.mini-btn').addEventListener('click', () => copyText(message.text || ''));
  return wrapper;
}

function createFileMessageNode(message) {
  const isSelf = message.sender?.nickname === state.nickname;
  const wrapper = document.createElement('div');
  wrapper.className = `message-row ${isSelf ? 'self' : 'other'}`;

  const isImage = message.type === 'image';
  const previewHtml = isImage
    ? `<img class="file-preview" src="${message.file.url}" alt="${escapeHtml(message.file.originalName)}" />`
    : '';

  wrapper.innerHTML = `
    <div class="message-bubble">
      <div class="message-meta">
        <strong>${escapeHtml(message.sender?.nickname || '匿名用户')}</strong>
        <span>${formatTime(message.createdAt)}</span>
      </div>
      <div class="file-card">
        ${previewHtml}
        <div class="file-meta">
          <strong>${escapeHtml(message.file.originalName)}</strong>
          <span>${escapeHtml(message.file.mimeType || '未知类型')} · ${formatBytes(message.file.size || 0)}</span>
        </div>
      </div>
      <div class="message-actions">
        <a class="mini-btn" href="${message.file.url}" download="${escapeHtml(message.file.originalName)}">下载</a>
        <button class="mini-btn copy-link-btn">复制链接</button>
      </div>
    </div>
  `;

  wrapper.querySelector('.copy-link-btn').addEventListener('click', () => copyText(location.origin + message.file.url));
  return wrapper;
}

function createSystemNode(notice) {
  const wrapper = document.createElement('div');
  wrapper.className = 'system-message';
  wrapper.textContent = `${notice.content} · ${formatTime(notice.createdAt)}`;
  return wrapper;
}

function addMessageToView(message) {
  removeEmptyState();
  let node;
  if (message.type === 'text') {
    node = createTextMessageNode(message);
  } else if (message.type === 'file' || message.type === 'image') {
    node = createFileMessageNode(message);
  } else {
    return;
  }

  els.messageList.appendChild(node);
  els.messageList.scrollTop = els.messageList.scrollHeight;
}

function addSystemNoticeToView(notice) {
  removeEmptyState();
  els.messageList.appendChild(createSystemNode(notice));
  els.messageList.scrollTop = els.messageList.scrollHeight;
}

function setJoinedUI(joined) {
  state.joined = joined;
  els.joinModal.classList.toggle('hidden', joined);
  els.roomDisplay.textContent = state.roomId || '-';
  els.nicknameDisplay.textContent = state.nickname || '-';
  els.connectionBadge.textContent = joined ? '已连接' : '未连接';
  els.connectionBadge.className = `badge ${joined ? 'badge-ok' : 'badge-wait'}`;
  refreshInviteBox();
}

function joinRoom({ nickname, roomId, password }) {
  return new Promise((resolve) => {
    socket.emit('room:join', { nickname, roomId, password }, resolve);
  });
}

function leaveRoom() {
  return new Promise((resolve) => {
    socket.emit('room:leave', {}, resolve);
  });
}

function updateCharCount() {
  const length = els.messageInput.value.length;
  els.charCount.textContent = `${length} / ${MAX_TEXT_LENGTH}`;
  if (length > MAX_TEXT_LENGTH) {
    els.charCount.classList.add('char-overflow');
    els.sendBtn.disabled = true;
  } else if (length > MAX_TEXT_LENGTH * 0.9) {
    els.charCount.classList.add('char-warning');
    els.charCount.classList.remove('char-overflow');
    els.sendBtn.disabled = false;
  } else {
    els.charCount.classList.remove('char-warning', 'char-overflow');
    els.sendBtn.disabled = false;
  }
}

async function sendTextMessage() {
  const text = els.messageInput.value;
  const trimmedText = text.trim();
  
  if (!trimmedText) {
    setStatus('请输入要发送的文字', 'error');
    return;
  }
  if (!state.joined) {
    setStatus('请先加入房间', 'error');
    return;
  }
  if (trimmedText.length > MAX_TEXT_LENGTH) {
    setStatus(`文字超过上限，当前最多 ${MAX_TEXT_LENGTH} 个字符`, 'error');
    return;
  }

  setStatus('正在发送文字...');
  socket.emit('message:text', { text }, (result) => {
    if (!result?.ok) {
      setStatus(result?.message || '发送失败', 'error');
      return;
    }
    els.messageInput.value = '';
    updateCharCount();
    setStatus('文字已发送', 'success');
  });
}

async function uploadSelectedFile(file) {
  if (!file) {
    setStatus('请先选择一个文件', 'error');
    return;
  }
  if (!state.joined) {
    setStatus('请先加入房间', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('roomId', state.roomId);
  formData.append('nickname', state.nickname);
  formData.append('password', state.password);
  formData.append('file', file);

  setStatus(`正在上传 ${file.name} ...`);

  try {
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.message || '上传失败');
    }

    els.fileInput.value = '';
    state.selectedFile = null;
    els.fileNameHint.textContent = '未选择文件';
    setStatus('文件上传成功，已实时同步', 'success');
  } catch (error) {
    setStatus(error.message || '上传失败', 'error');
  }
}

async function performJoinFromForm(options = {}) {
  const { silent = false } = options;
  const nickname = els.nicknameInput.value.trim() || generateDefaultNickname();
  const roomId = els.roomInput.value.trim();
  const password = els.passwordInput.value;

  if (!silent) setStatus('正在进入房间...');
  state.joining = true;
  const result = await joinRoom({ nickname, roomId, password });
  if (!result?.ok) {
    state.joining = false;
    setStatus(result?.message || '进入房间失败', 'error');
    return false;
  }

  state.nickname = result.nickname;
  state.roomId = result.roomId;
  state.password = password;
  saveSession();
  location.hash = new URLSearchParams({ room: state.roomId, ...(state.password ? { password: state.password } : {}) }).toString();

  resetMessageList();
  (result.history || []).forEach(addMessageToView);
  renderUsers(result.users || []);
  setJoinedUI(true);
  state.joining = false;
  if (!silent) setStatus('已成功进入房间', 'success');
  return true;
}

// ===== 事件绑定 =====

els.joinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await performJoinFromForm();
});

els.sendBtn.addEventListener('click', sendTextMessage);

els.clearComposerBtn.addEventListener('click', () => {
  els.messageInput.value = '';
  els.fileInput.value = '';
  state.selectedFile = null;
  els.fileNameHint.textContent = '未选择文件';
  updateCharCount();
  setStatus('输入区已清空');
});

els.rejoinBtn.addEventListener('click', async () => {
  if (state.joined) {
    await leaveRoom();
  }
  state.joined = false;
  state.roomId = '';
  state.password = '';
  resetMessageList();
  renderUsers([]);
  setJoinedUI(false);
  setStatus('你已退出当前房间');
});

els.copyInviteBtn.addEventListener('click', () => {
  if (!state.joined || !state.roomId) {
    setStatus('请先进入房间后再复制邀请链接', 'error');
    return;
  }
  copyText(buildInviteUrl(state.roomId, state.password));
});

els.messageInput.addEventListener('keydown', (event) => {
  // Ctrl+Enter 或 Cmd+Enter 发送
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    sendTextMessage();
  }
});

// 字数统计
els.messageInput.addEventListener('input', updateCharCount);

els.fileInput.addEventListener('change', (event) => {
  state.selectedFile = event.target.files?.[0] || null;
  els.fileNameHint.textContent = state.selectedFile ? state.selectedFile.name : '未选择文件';
});

els.uploadBtn.addEventListener('click', () => uploadSelectedFile(state.selectedFile));

// ===== 剪贴板粘贴支持 =====
document.addEventListener('paste', async (event) => {
  const clipboardData = event.clipboardData || window.clipboardData;
  if (!clipboardData) return;

  // 检查焦点是否在允许默认粘贴的输入框中
  const activeElement = document.activeElement;
  const isInMessageInput = activeElement === els.messageInput;
  const isInNicknameInput = activeElement === els.nicknameInput;
  const isInRoomInput = activeElement === els.roomInput;
  const isInPasswordInput = activeElement === els.passwordInput;
  
  // 如果焦点在允许默认粘贴的输入框中，让浏览器处理
  if (isInMessageInput || isInNicknameInput || isInRoomInput || isInPasswordInput) {
    return;
  }

  // 如果没有加入房间，不处理
  if (!state.joined) {
    return;
  }

  // 检查是否有图片
  const items = clipboardData.items;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.startsWith('image/')) {
      event.preventDefault();
      const imageItem = items[i];
      const blob = imageItem.getAsFile();
      
      if (blob) {
        // 生成文件名
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `pasted-image-${timestamp}.png`;
        
        // 创建文件对象
        const file = new File([blob], filename, { type: blob.type || 'image/png' });
        
        setStatus('已检测到剪贴板图片，正在上传...', 'normal');
        await uploadSelectedFile(file);
      }
      return;
    }
  }

  // 检查是否有纯文字
  const text = clipboardData.getData('text/plain') || clipboardData.getData('text');
  if (text) {
    event.preventDefault();
    // 将文字填入消息输入框
    els.messageInput.value = text;
    els.messageInput.focus();
    updateCharCount();
    setStatus('已将剪贴板文字填入输入框', 'success');
  }
});

// 拖拽支持
['dragenter', 'dragover'].forEach((eventName) => {
  window.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropZone.classList.remove('hidden');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  window.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (eventName === 'drop') {
      const file = event.dataTransfer?.files?.[0];
      if (file) {
        state.selectedFile = file;
        els.fileNameHint.textContent = file.name;
        uploadSelectedFile(file);
      }
    }
    els.dropZone.classList.add('hidden');
  });
});

// ===== Socket.IO 事件 =====
socket.on('connect', async () => {
  if (state.joined) {
    els.connectionBadge.textContent = '已连接';
    els.connectionBadge.className = 'badge badge-ok';
    return;
  }

  if (!state.joining && state.roomId && state.nickname) {
    setStatus('网络已恢复，正在自动重连房间...');
    await performJoinFromForm({ silent: true });
    if (state.joined) {
      setStatus('已自动重连房间', 'success');
    }
  }
});

socket.on('disconnect', () => {
  els.connectionBadge.textContent = '连接断开';
  els.connectionBadge.className = 'badge badge-wait';
  setStatus('连接已断开，网络恢复后会自动尝试重连', 'error');
});

socket.on('message:new', (message) => {
  addMessageToView(message);
});

socket.on('system:notice', (notice) => {
  addSystemNoticeToView(notice);
});

socket.on('room:users', (users) => {
  renderUsers(users || []);
});

// ===== 初始化 =====
async function bootstrap() {
  loadSession();
  if (!els.nicknameInput.value.trim()) {
    els.nicknameInput.value = generateDefaultNickname();
  }
  resetMessageList();
  setJoinedUI(false);
  updateCharCount();
  setStatus('准备就绪，支持 Ctrl+V 粘贴图片或文字');

  const hasInvite = applyInviteHashToForm();
  if (hasInvite) {
    setStatus('检测到邀请链接，正在自动进入房间...');
    await performJoinFromForm();
  }
}

bootstrap();
