const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const { GameState } = require('./gameState');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Serve static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', rooms: rooms.size });
});

// ── State ──────────────────────────────────────────
const rooms = new Map();       // roomCode -> GameState
const clients = new Map();     // ws -> { roomCode, playerId }

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms.has(code));
  return code;
}

function generatePlayerId() {
  return 'p_' + Math.random().toString(36).substring(2, 10);
}

function broadcastToRoom(roomCode, message, excludeWs = null) {
  for (const [ws, info] of clients) {
    if (info.roomCode === roomCode && ws !== excludeWs && ws.readyState === 1) {
      ws.send(JSON.stringify(message));
    }
  }
}

function sendToPlayer(playerId, message) {
  for (const [ws, info] of clients) {
    if (info.playerId === playerId && ws.readyState === 1) {
      ws.send(JSON.stringify(message));
      return;
    }
  }
}

function sendGameState(roomCode) {
  const game = rooms.get(roomCode);
  if (!game) return;
  for (const [ws, info] of clients) {
    if (info.roomCode === roomCode && ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'game_state',
        state: game.getPublicState(info.playerId),
      }));
    }
  }
}

// ── WebSocket Handlers ─────────────────────────────
wss.on('connection', (ws) => {
  let clientInfo = { roomCode: null, playerId: null };
  clients.set(ws, clientInfo);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'create_room': {
        const roomCode = generateRoomCode();
        const playerId = generatePlayerId();
        const game = new GameState(roomCode, playerId);
        game.addPlayer(playerId, msg.name, msg.emoji, msg.color);
        rooms.set(roomCode, game);
        clientInfo.roomCode = roomCode;
        clientInfo.playerId = playerId;

        ws.send(JSON.stringify({
          type: 'room_created',
          roomCode,
          playerId,
          state: game.getPublicState(playerId),
        }));
        break;
      }

      case 'join_room': {
        const code = (msg.roomCode || '').toUpperCase().trim();
        const game = rooms.get(code);
        if (!game) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
          return;
        }
        if (game.phase !== 'lobby') {
          ws.send(JSON.stringify({ type: 'error', message: 'Game already in progress' }));
          return;
        }
        if (game.players.size >= 10) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room is full (max 10 players)' }));
          return;
        }

        const playerId = generatePlayerId();
        game.addPlayer(playerId, msg.name, msg.emoji, msg.color);
        clientInfo.roomCode = code;
        clientInfo.playerId = playerId;

        ws.send(JSON.stringify({
          type: 'room_joined',
          roomCode: code,
          playerId,
          state: game.getPublicState(playerId),
        }));

        // Notify others
        broadcastToRoom(code, {
          type: 'player_joined',
          player: game.players.get(playerId),
          players: game.getPlayerList(),
        }, ws);
        break;
      }

      case 'start_game': {
        const game = rooms.get(clientInfo.roomCode);
        if (!game) return;
        if (clientInfo.playerId !== game.hostId) return;
        if (game.players.size < 2) {
          ws.send(JSON.stringify({ type: 'error', message: 'Need at least 2 players' }));
          return;
        }

        game.startGame();
        sendGameState(clientInfo.roomCode);
        break;
      }

      case 'submit_clue': {
        const game = rooms.get(clientInfo.roomCode);
        if (!game) return;
        if (!game.submitClue(clientInfo.playerId, msg.clue)) return;

        broadcastToRoom(clientInfo.roomCode, {
          type: 'clue_submitted',
          clue: msg.clue,
        });
        sendGameState(clientInfo.roomCode);
        break;
      }

      case 'move_dial': {
        const game = rooms.get(clientInfo.roomCode);
        if (!game) return;
        if (!game.moveDial(clientInfo.playerId, msg.position)) return;

        // Broadcast the new average to all
        broadcastToRoom(clientInfo.roomCode, {
          type: 'dial_update',
          averageDialPosition: game.averageDialPosition,
          playerId: clientInfo.playerId,
        });
        break;
      }

      case 'set_ready': {
        const game = rooms.get(clientInfo.roomCode);
        if (!game) return;
        const allReady = game.setReady(clientInfo.playerId);

        broadcastToRoom(clientInfo.roomCode, {
          type: 'ready_update',
          readyCount: game.readyPlayers.size,
          totalGuessers: game.players.size - 1,
          playerId: clientInfo.playerId,
        });

        if (allReady) {
          // Reveal target and score
          const result = game.revealAndScore();
          broadcastToRoom(clientInfo.roomCode, {
            type: 'reveal_target',
            ...result,
            totalScore: game.totalScore,
            currentRound: game.currentRound,
            totalRounds: game.totalRounds,
          });
          sendGameState(clientInfo.roomCode);
        }
        break;
      }

      case 'next_round': {
        const game = rooms.get(clientInfo.roomCode);
        if (!game) return;
        if (clientInfo.playerId !== game.hostId) return;

        const hasMore = game.startNewRound();
        if (!hasMore) {
          game.phase = 'game_over';
        }
        sendGameState(clientInfo.roomCode);
        break;
      }

      case 'play_again': {
        const game = rooms.get(clientInfo.roomCode);
        if (!game) return;
        if (clientInfo.playerId !== game.hostId) return;

        game.startGame();
        sendGameState(clientInfo.roomCode);
        break;
      }

      case 'emoji_reaction': {
        broadcastToRoom(clientInfo.roomCode, {
          type: 'emoji_broadcast',
          emoji: msg.emoji,
          playerId: clientInfo.playerId,
          playerName: (() => {
            const g = rooms.get(clientInfo.roomCode);
            return g?.players.get(clientInfo.playerId)?.name || 'Player';
          })(),
        }, ws);
        break;
      }
    }
  });

  ws.on('close', () => {
    const { roomCode, playerId } = clientInfo;
    if (roomCode && playerId) {
      const game = rooms.get(roomCode);
      if (game) {
        game.removePlayer(playerId);
        if (game.players.size === 0) {
          rooms.delete(roomCode);
        } else {
          broadcastToRoom(roomCode, {
            type: 'player_left',
            playerId,
            players: game.getPlayerList(),
            newHostId: game.hostId,
          });
          // If we're in dial phase, check if remaining are all ready
          if (game.phase === 'dial') {
            const nonPsychic = game.players.size - 1;
            if (nonPsychic > 0 && game.readyPlayers.size >= nonPsychic) {
              const result = game.revealAndScore();
              broadcastToRoom(roomCode, {
                type: 'reveal_target',
                ...result,
                totalScore: game.totalScore,
                currentRound: game.currentRound,
                totalRounds: game.totalRounds,
              });
              sendGameState(roomCode);
            }
          }
        }
      }
    }
    clients.delete(ws);
  });

  ws.on('error', () => {
    clients.delete(ws);
  });
});

// ── Start ──────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🌊 Wavelength server running at http://localhost:${PORT}\n`);
});
