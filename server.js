const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// index.html'i hem public/ içinde hem de server.js ile aynı klasörde arar
const fs = require('fs');
const candidates = [
  path.join(__dirname, 'public', 'index.html'),
  path.join(__dirname, 'index.html'),
  path.join(__dirname, 'foot_it_neon_cage_football.html'),
];
const indexFile = candidates.find((f) => fs.existsSync(f));
if (!indexFile) {
  console.error('HATA: index.html bulunamadı. Şu konumlardan birine koy:\n - ' + candidates.slice(0, 2).join('\n - '));
} else {
  console.log('Oyun dosyası:', indexFile);
  if (indexFile.includes(path.join('public', ''))) app.use(express.static(path.dirname(indexFile)));
}
app.get('/', (_req, res) => indexFile ? res.sendFile(indexFile) : res.status(500).send('index.html bulunamadı (public/index.html olmalı)'));
app.get('/health', (_req, res) => res.send('ok'));

// code -> { host: socketId, guest: socketId|null }
const rooms = new Map();
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
  for (let t = 0; t < 100; t++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CHARS[Math.floor(Math.random() * CHARS.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}

function closeRoom(socket, notifyMsg) {
  const code = socket.data.room;
  if (!code) return;
  const room = rooms.get(code);
  socket.data.room = null;
  socket.leave(code);
  if (!room) return;
  if (socket.data.role === 'host') {
    io.to(code).emit('room-closed', notifyMsg || 'Kurucu ayrıldı.');
    rooms.delete(code);
    io.in(code).socketsLeave(code);
  } else if (room.guest === socket.id) {
    room.guest = null;
    io.to(room.host).emit('guest-left');
  }
}

io.on('connection', (socket) => {
  socket.on('create-room', (_data, ack) => {
    closeRoom(socket);
    const code = newCode();
    if (!code) return ack && ack({ ok: false, msg: 'Oda oluşturulamadı.' });
    rooms.set(code, { host: socket.id, guest: null });
    socket.data.room = code;
    socket.data.role = 'host';
    socket.join(code);
    ack && ack({ ok: true, code });
  });

  socket.on('join-room', (rawCode, ack) => {
    const code = String(rawCode || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return ack && ack({ ok: false, msg: 'Bu koda sahip aktif bir oda bulunamadı.' });
    if (room.guest) return ack && ack({ ok: false, msg: 'Oda dolu.' });
    closeRoom(socket);
    room.guest = socket.id;
    socket.data.room = code;
    socket.data.role = 'guest';
    socket.join(code);
    io.to(room.host).emit('guest-joined');
    ack && ack({ ok: true, code });
  });

  // misafir -> kurucu (girdi)
  socket.on('guest-input', (inp) => {
    const room = rooms.get(socket.data.room);
    if (room && socket.data.role === 'guest') io.to(room.host).volatile.emit('guest-input', inp);
  });

  // kurucu -> misafir (dünya durumu)
  socket.on('world-state', (st) => {
    const room = rooms.get(socket.data.room);
    if (room && room.guest && socket.data.role === 'host') io.to(room.guest).volatile.emit('world-state', st);
  });

  socket.on('leave-room', () => closeRoom(socket));
  socket.on('disconnect', () => closeRoom(socket, 'Kurucunun bağlantısı koptu.'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`FOOT IT! sunucusu: http://localhost:${PORT}`));
