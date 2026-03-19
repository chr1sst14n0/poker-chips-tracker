const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

const PORT = process.env.PORT || 3000;

const rooms = new Map();

function generateRoomCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  if (rooms.has(code)) {
    return generateRoomCode();
  }
  return code;
}

function getPlayerColor(index) {
  const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A',
    '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2',
    '#F8B739', '#52B788'
  ];
  return colors[index % colors.length];
}

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('createRoom', (callback) => {
    const roomCode = generateRoomCode();
    const room = {
      code: roomCode,
      host: socket.id,
      players: new Map(),
      gameType: '',
      initialChips: 0,
      smallBlind: 0,
      bigBlind: 0,
      gameStarted: false,
      currentPot: 0,
      currentHandNumber: 0,
      handHistory: [],
      currentHandBets: new Map(),
      activePlayers: new Set(),
      currentBlindIndex: 0
    };
    rooms.set(roomCode, room);
    socket.join(roomCode);
    callback({ success: true, roomCode });
  });

  socket.on('joinRoom', ({ roomCode, nickname }, callback) => {
    const room = rooms.get(roomCode);
    if (!room) {
      callback({ success: false, error: 'Stanza non trovata' });
      return;
    }

    const existingPlayer = Array.from(room.players.values()).find(p => p.nickname === nickname);
    if (existingPlayer) {
      if (existingPlayer.socketId !== socket.id && io.sockets.sockets.get(existingPlayer.socketId)) {
        callback({ success: false, error: 'Nickname già in uso' });
        return;
      }
      existingPlayer.socketId = socket.id;
      existingPlayer.connected = true;
      socket.join(roomCode);
      socket.data.roomCode = roomCode;
      socket.data.nickname = nickname;
      
      callback({
        success: true,
        isHost: room.host === existingPlayer.originalHostId,
        players: Array.from(room.players.values()).map(p => ({
          id: p.id,
          nickname: p.nickname,
          chips: p.chips,
          color: p.color,
          connected: p.connected,
          lastAction: p.lastAction,
          isFolded: p.isFolded
        })),
        gameStarted: room.gameStarted,
        gameType: room.gameType,
        initialChips: room.initialChips,
        smallBlind: room.smallBlind,
        bigBlind: room.bigBlind,
        currentPot: room.currentPot,
        currentHandNumber: room.currentHandNumber,
        handHistory: room.handHistory
      });

      io.to(roomCode).emit('playerReconnected', {
        nickname: nickname,
        players: Array.from(room.players.values()).map(p => ({
          id: p.id,
          nickname: p.nickname,
          chips: p.chips,
          color: p.color,
          connected: p.connected,
          lastAction: p.lastAction,
          isFolded: p.isFolded
        }))
      });
      return;
    }

    if (room.players.size >= 10) {
      callback({ success: false, error: 'Stanza piena (max 10 giocatori)' });
      return;
    }

    const playerColorIndex = room.players.size;
    const player = {
      id: socket.id,
      socketId: socket.id,
      originalHostId: room.players.size === 0 ? socket.id : null,
      nickname: nickname,
      chips: room.gameStarted ? room.initialChips : 0,
      color: getPlayerColor(playerColorIndex),
      connected: true,
      lastAction: '',
      isFolded: false
    };

    room.players.set(socket.id, player);
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.nickname = nickname;

    callback({
      success: true,
      isHost: socket.id === room.host,
      players: Array.from(room.players.values()).map(p => ({
        id: p.id,
        nickname: p.nickname,
        chips: p.chips,
        color: p.color,
        connected: p.connected,
        lastAction: p.lastAction,
        isFolded: p.isFolded
      })),
      gameStarted: room.gameStarted,
      gameType: room.gameType,
      initialChips: room.initialChips,
      smallBlind: room.smallBlind,
      bigBlind: room.bigBlind,
      currentPot: room.currentPot,
      currentHandNumber: room.currentHandNumber,
      handHistory: room.handHistory
    });

    io.to(roomCode).emit('playerJoined', {
      player: {
        id: player.id,
        nickname: player.nickname,
        chips: player.chips,
        color: player.color,
        connected: player.connected,
        lastAction: player.lastAction,
        isFolded: player.isFolded
      },
      players: Array.from(room.players.values()).map(p => ({
        id: p.id,
        nickname: p.nickname,
        chips: p.chips,
        color: p.color,
        connected: p.connected,
        lastAction: p.lastAction,
        isFolded: p.isFolded
      }))
    });
  });

  socket.on('startGame', ({ roomCode, gameType, initialChips, smallBlind, bigBlind }, callback) => {
    const room = rooms.get(roomCode);
    if (!room || room.host !== socket.id) {
      callback({ success: false, error: 'Non autorizzato' });
      return;
    }

    if (room.players.size < 2) {
      callback({ success: false, error: 'Servono almeno 2 giocatori' });
      return;
    }

    room.gameType = gameType;
    room.initialChips = initialChips;
    room.smallBlind = smallBlind;
    room.bigBlind = bigBlind;
    room.gameStarted = true;
    room.currentHandNumber = 0;

    room.players.forEach(player => {
      player.chips = initialChips;
      player.lastAction = '';
      player.isFolded = false;
    });

    callback({ success: true });

    io.to(roomCode).emit('gameStarted', {
      gameType: room.gameType,
      initialChips: room.initialChips,
      smallBlind: room.smallBlind,
      bigBlind: room.bigBlind,
      players: Array.from(room.players.values()).map(p => ({
        id: p.id,
        nickname: p.nickname,
        chips: p.chips,
        color: p.color,
        connected: p.connected,
        lastAction: p.lastAction,
        isFolded: p.isFolded
      }))
    });
  });

  socket.on('playerAction', ({ roomCode, action, amount }, callback) => {
    const room = rooms.get(roomCode);
    if (!room || !room.gameStarted) {
      callback({ success: false, error: 'Gioco non avviato' });
      return;
    }

    const player = room.players.get(socket.id);
    if (!player) {
      callback({ success: false, error: 'Giocatore non trovato' });
      return;
    }

    let betAmount = 0;
    let actionText = '';

    switch (action) {
      case 'bet':
        if (amount > player.chips) {
          callback({ success: false, error: 'Fiches insufficienti' });
          return;
        }
        betAmount = amount;
        actionText = `Bet ${betAmount.toLocaleString()}`;
        break;

      case 'raise':
        if (amount > player.chips) {
          callback({ success: false, error: 'Fiches insufficienti' });
          return;
        }
        betAmount = amount;
        actionText = `Raise ${betAmount.toLocaleString()}`;
        break;

      case 'call':
        const currentBet = Math.max(...Array.from(room.currentHandBets.values()), 0);
        const playerBet = room.currentHandBets.get(socket.id) || 0;
        betAmount = Math.min(currentBet - playerBet, player.chips);
        actionText = `Call ${betAmount.toLocaleString()}`;
        break;

      case 'check':
        betAmount = 0;
        actionText = 'Check';
        break;

      case 'fold':
        betAmount = 0;
        player.isFolded = true;
        actionText = 'Fold';
        break;

      case 'allin':
        betAmount = player.chips;
        actionText = `All-in ${betAmount.toLocaleString()}`;
        break;

      default:
        callback({ success: false, error: 'Azione non valida' });
        return;
    }

    player.chips -= betAmount;
    room.currentPot += betAmount;
    player.lastAction = actionText;

    const currentPlayerBet = room.currentHandBets.get(socket.id) || 0;
    room.currentHandBets.set(socket.id, currentPlayerBet + betAmount);

    callback({ success: true });

    io.to(roomCode).emit('actionPerformed', {
      playerId: socket.id,
      nickname: player.nickname,
      action: actionText,
      pot: room.currentPot,
      players: Array.from(room.players.values()).map(p => ({
        id: p.id,
        nickname: p.nickname,
        chips: p.chips,
        color: p.color,
        connected: p.connected,
        lastAction: p.lastAction,
        isFolded: p.isFolded
      }))
    });
  });

  socket.on('closeHand', ({ roomCode, winners }, callback) => {
    const room = rooms.get(roomCode);
    if (!room || room.host !== socket.id) {
      callback({ success: false, error: 'Non autorizzato' });
      return;
    }

    if (!winners || winners.length === 0) {
      callback({ success: false, error: 'Seleziona almeno un vincitore' });
      return;
    }

    const potShare = Math.floor(room.currentPot / winners.length);
    const remainder = room.currentPot % winners.length;

    winners.forEach((winnerId, index) => {
      const winner = room.players.get(winnerId);
      if (winner) {
        winner.chips += potShare + (index === 0 ? remainder : 0);
      }
    });

    room.currentHandNumber++;

    const winnerNames = winners.map(wId => {
      const p = room.players.get(wId);
      return p ? p.nickname : 'Unknown';
    }).join(', ');

    const handRecord = {
      handNumber: room.currentHandNumber,
      winners: winnerNames,
      pot: room.currentPot,
      timestamp: new Date().toISOString()
    };

    room.handHistory.unshift(handRecord);

    const oldPot = room.currentPot;
    room.currentPot = 0;
    room.currentHandBets.clear();

    room.players.forEach(player => {
      player.lastAction = '';
      player.isFolded = false;
    });

    room.currentBlindIndex = (room.currentBlindIndex + 1) % room.players.size;

    callback({ success: true });

    io.to(roomCode).emit('handClosed', {
      winners: winners.map(wId => {
        const p = room.players.get(wId);
        return p ? { id: p.id, nickname: p.nickname } : null;
      }).filter(w => w !== null),
      potAmount: oldPot,
      players: Array.from(room.players.values()).map(p => ({
        id: p.id,
        nickname: p.nickname,
        chips: p.chips,
        color: p.color,
        connected: p.connected,
        lastAction: p.lastAction,
        isFolded: p.isFolded
      })),
      currentPot: room.currentPot,
      currentHandNumber: room.currentHandNumber,
      handHistory: room.handHistory
    });
  });

  socket.on('endSession', ({ roomCode }, callback) => {
    const room = rooms.get(roomCode);
    if (!room || room.host !== socket.id) {
      callback({ success: false, error: 'Non autorizzato' });
      return;
    }

    const finalStandings = Array.from(room.players.values()).map(p => ({
      nickname: p.nickname,
      finalChips: p.chips,
      difference: p.chips - room.initialChips,
      color: p.color
    })).sort((a, b) => b.finalChips - a.finalChips);

    callback({ success: true });

    io.to(roomCode).emit('sessionEnded', {
      finalStandings: finalStandings
    });

    rooms.delete(roomCode);
  });

  socket.on('getActivePlayers', ({ roomCode }, callback) => {
    const room = rooms.get(roomCode);
    if (!room) {
      callback({ success: false, error: 'Stanza non trovata' });
      return;
    }

    const activePlayers = Array.from(room.players.values())
      .filter(p => !p.isFolded && p.chips > 0)
      .map(p => ({
        id: p.id,
        nickname: p.nickname,
        color: p.color
      }));

    callback({ success: true, activePlayers });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    const roomCode = socket.data.roomCode;
    const nickname = socket.data.nickname;

    if (roomCode) {
      const room = rooms.get(roomCode);
      if (room) {
        const player = room.players.get(socket.id);
        if (player) {
          player.connected = false;

          io.to(roomCode).emit('playerDisconnected', {
            nickname: nickname,
            players: Array.from(room.players.values()).map(p => ({
              id: p.id,
              nickname: p.nickname,
              chips: p.chips,
              color: p.color,
              connected: p.connected,
              lastAction: p.lastAction,
              isFolded: p.isFolded
            }))
          });

          if (room.host === socket.id) {
            io.to(roomCode).emit('hostDisconnected');
          }
        }
      }
    }
  });
});

http.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
