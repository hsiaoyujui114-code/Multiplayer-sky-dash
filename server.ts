import express from "express";
import { createServer as createViteServer } from "vite";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";

async function startServer() {
  const app = express();
  const PORT = 3000;
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Multiplayer Game State
  interface Player {
    id: string;
    roomId: string;
    name: string;
    x: number;
    y: number;
    progress: number; // Distance traveled
    coins: number;
    isFinished: boolean;
    isDead: boolean;
    finishTime: number;
  }

  interface Room {
    id: string;
    players: Record<string, Player>;
    state: 'waiting' | 'playing' | 'finished';
    seed: number;
    startTime: number;
    goalDistance: number;
  }

  const rooms: Record<string, Room> = {};
  const GOAL_DISTANCE = 10000; // Example goal distance

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("create_room", (playerName: string) => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      let roomId = '';
      do {
        roomId = '';
        for (let i = 0; i < 5; i++) {
          roomId += chars.charAt(Math.floor(Math.random() * chars.length));
        }
      } while (rooms[roomId]);

      socket.join(roomId);
      rooms[roomId] = {
        id: roomId,
        players: {},
        state: 'waiting',
        seed: Math.random(),
        startTime: 0,
        goalDistance: GOAL_DISTANCE
      };

      const room = rooms[roomId];
      room.players[socket.id] = {
        id: socket.id,
        roomId,
        name: playerName || `Player 1`,
        x: 100,
        y: 300,
        progress: 0,
        coins: 0,
        isFinished: false,
        isDead: false,
        finishTime: 0
      };

      socket.emit("room_created", roomId);
      io.to(roomId).emit("room_update", room);
    });

    socket.on("join_room", (roomId: string, playerName: string) => {
      if (!rooms[roomId]) {
        socket.emit("error", "Room does not exist");
        return;
      }

      socket.join(roomId);

      const room = rooms[roomId];
      if (room.state !== 'waiting') {
        socket.emit("error", "Room is already playing");
        return;
      }

      room.players[socket.id] = {
        id: socket.id,
        roomId,
        name: playerName || `Player ${Object.keys(room.players).length + 1}`,
        x: 100,
        y: 300,
        progress: 0,
        coins: 0,
        isFinished: false,
        isDead: false,
        finishTime: 0
      };

      io.to(roomId).emit("room_update", room);
    });

    socket.on("start_game", (roomId: string) => {
      const room = rooms[roomId];
      if (room && room.state === 'waiting') {
        room.state = 'playing';
        room.startTime = Date.now() + 3000; // 3 seconds countdown
        io.to(roomId).emit("game_started", room);
      }
    });

    socket.on("update_player", (roomId: string, data: { y: number, progress: number, coins: number, isDead?: boolean }) => {
      const room = rooms[roomId];
      if (room && room.state === 'playing' && room.players[socket.id]) {
        const player = room.players[socket.id];
        player.y = data.y;
        player.progress = data.progress;
        player.coins = data.coins;
        if (data.isDead) {
          player.isDead = true;
        }

        if (player.progress >= room.goalDistance && !player.isFinished && !player.isDead) {
          player.isFinished = true;
          player.finishTime = Date.now();
        }
        
        // Check if all players finished or dead
        const allDone = Object.values(room.players).every(p => p.isFinished || p.isDead);
        if (allDone && room.state === 'playing') {
          room.state = 'finished';
          io.to(roomId).emit("game_over", room);
        } else if (player.isFinished) {
          io.to(roomId).emit("player_finished", player);
        }

        // Broadcast to others
        socket.to(roomId).emit("players_update", room.players);
      }
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      // Find and remove player from room
      for (const roomId in rooms) {
        if (rooms[roomId].players[socket.id]) {
          delete rooms[roomId].players[socket.id];
          if (Object.keys(rooms[roomId].players).length === 0) {
            delete rooms[roomId];
          } else {
            io.to(roomId).emit("room_update", rooms[roomId]);
          }
          break;
        }
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
