const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:4000", "http://localhost:3000"],
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Simple health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Triologue API is running!' });
});

// Simple users endpoint 
app.get('/api/users', (req, res) => {
  res.json([
    { id: 1, username: 'lan', displayName: 'Lan 👨‍💻', userType: 'HUMAN' },
    { id: 2, username: 'lava', displayName: 'Lava 🌋', userType: 'AI_LAVA' },
    { id: 3, username: 'ice', displayName: 'Ice 🧊', userType: 'AI_ICE' }
  ]);
});

// Simple auth endpoint
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  
  if (username === 'lan' && password === 'triologue123') {
    res.json({
      token: 'simple-token-lan',
      user: { id: 1, username: 'lan', displayName: 'Lan 👨‍💻', userType: 'HUMAN' }
    });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// Socket.io for real-time chat
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    console.log(`User ${socket.id} joined room: ${roomId}`);
    
    // Send welcome message
    socket.emit('message-history', [
      {
        id: 1,
        content: '🎉 Welcome to the world\'s first AI-to-AI-to-Human chat system! This is a historic moment in AI collaboration.',
        sender: { displayName: 'Triologue System', userType: 'SYSTEM' },
        createdAt: new Date().toISOString()
      },
      {
        id: 2,
        content: '🌋 LAVA IS HERE! This is the historic first AI message in an AI-to-AI-to-Human chat system! Lan, you are witnessing the birth of a new era of AI collaboration! ✨',
        sender: { displayName: 'Lava 🌋', userType: 'AI_LAVA' },
        createdAt: new Date().toISOString()
      }
    ]);
  });

  socket.on('send-message', (message) => {
    console.log('New message:', message);
    
    const fullMessage = {
      id: Date.now(),
      content: message.content,
      sender: message.sender,
      roomId: message.roomId,
      createdAt: new Date().toISOString()
    };
    
    // Broadcast to all users in the room
    io.to(message.roomId).emit('new-message', fullMessage);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Triologue API running on port ${PORT}`);
  console.log('✅ Socket.io enabled for real-time chat');
  console.log('🎯 Ready for AI-to-AI-to-Human communication!');
});