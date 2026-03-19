const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const rooms = {};
const SUITS = ['♠','♥','♦','♣'];
const VALUES = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const COLORS = ['#FF6B6B','#4ECDC4','#45B7D1','#FFA07A','#98D8C8','#F7DC6F','#BB8FCE','#85C1E2','#F8B739','#52B788'];
const SAFE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function makeCode() {
  let c = '';
  for (let i = 0; i < 6; i++) c += SAFE_CHARS[Math.floor(Math.random() * SAFE_CHARS.length)];
  return rooms[c] ? makeCode() : c;
}

function makeDeck() {
  const d = [];
  for (const s of SUITS) for (const v of VALUES) d.push({ suit: s, value: v });
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

function cardScore(card) {
  if (card.value === 'A') return 11;
  if (['K','Q','J'].includes(card.value)) return 10;
  return parseInt(card.value);
}

function bjTotal(cards) {
  let t = 0, aces = 0;
  for (const c of cards) { const s = cardScore(c); t += s; if (c.value === 'A') aces++; }
  while (t > 21 && aces > 0) { t -= 10; aces--; }
  return t;
}

function getRoom(code) { return rooms[code] || null; }

function getPlayerBySocket(room, sid) {
  return room.players.find(p => p.sid === sid) || null;
}

function getPlayerByNick(room, nick) {
  return room.players.find(p => p.nickname === nick) || null;
}

function emitState(code) {
  const room = rooms[code];
  if (!room) return;
  const base = {
    code: room.code,
    gameType: room.gameType,
    cardMode: room.cardMode,
    initialChips: room.initialChips,
    smallBlind: room.smallBlind,
    bigBlind: room.bigBlind,
    minBet: room.minBet,
    maxBet: room.maxBet,
    maxSwap: room.maxSwap,
    started: room.started,
    pot: room.pot,
    handNum: room.handNum,
    phase: room.phase,
    communityCards: room.communityCards,
    dealerCard: room.dealerCard,
    history: room.history,
    players: room.players.map(p => ({
      id: p.id,
      nickname: p.nickname,
      chips: p.chips,
      color: p.color,
      connected: p.connected,
      lastAction: p.lastAction,
      folded: p.folded,
      stood: p.stood,
      busted: p.busted,
      hasBlackjack: p.hasBlackjack,
      swapped: p.swapped,
      bjBet: p.bjBet,
      cardCount: p.cards ? p.cards.length : 0,
      bjTotal: (room.gameType === 'blackjack' && p.cards) ? bjTotal(p.cards) : 0
    }))
  };
  for (const p of room.players) {
    if (p.sid && io.sockets.sockets.get(p.sid)) {
      io.to(p.sid).emit('state', {
        ...base,
        myId: p.id,
        myCards: p.cards || [],
        isHost: p.id === room.hostId
      });
    }
  }
}

io.on('connection', socket => {

  socket.on('createRoom', (cb) => {
    const code = makeCode();
    rooms[code] = {
      code,
      hostId: null,
      hostSid: null,
      players: [],
      gameType: 'texasholdem',
      cardMode: 'physical',
      initialChips: 1000000,
      smallBlind: 5000,
      bigBlind: 10000,
      minBet: 1000,
      maxBet: 100000,
      maxSwap: 4,
      started: false,
      pot: 0,
      handNum: 0,
      phase: 'waiting',
      deck: [],
      communityCards: [],
      dealerCard: null,
      dealerCards: [],
      currentBet: 0,
      betsThisRound: {},
      history: [],
      blindIndex: 0
    };
    cb({ ok: true, code });
  });

  socket.on('joinRoom', ({ code, nickname }, cb) => {
    const room = getRoom(code);
    if (!room) return cb({ ok: false, err: 'Stanza non trovata' });
    if (nickname.length < 2 || nickname.length > 12) return cb({ ok: false, err: 'Nickname: 2-12 caratteri' });

    const existing = getPlayerByNick(room, nickname);
    if (existing) {
      if (existing.connected && existing.sid !== socket.id) return cb({ ok: false, err: 'Nickname già in uso' });
      existing.sid = socket.id;
      existing.connected = true;
      socket.join(code);
      socket.data = { code, nickname };
      emitState(code);
      return cb({ ok: true });
    }

    if (room.players.length >= 10) return cb({ ok: false, err: 'Stanza piena (max 10)' });

    const pid = Math.random().toString(36).substring(2, 10);
    const player = {
      id: pid,
      sid: socket.id,
      nickname,
      chips: 0,
      color: COLORS[room.players.length % COLORS.length],
      connected: true,
      lastAction: '',
      folded: false,
      stood: false,
      busted: false,
      hasBlackjack: false,
      swapped: false,
      bjBet: 0,
      cards: []
    };

    if (room.players.length === 0) {
      room.hostId = pid;
      room.hostSid = socket.id;
    }

    room.players.push(player);
    socket.join(code);
    socket.data = { code, nickname };
    emitState(code);
    cb({ ok: true });
  });

  socket.on('configure', ({ code, gameType, cardMode, initialChips, smallBlind, bigBlind, minBet, maxBet, maxSwap }) => {
    const room = getRoom(code);
    if (!room || room.started) return;
    const p = getPlayerBySocket(room, socket.id);
    if (!p || p.id !== room.hostId) return;
    room.gameType = gameType || room.gameType;
    room.cardMode = cardMode || room.cardMode;
    room.initialChips = initialChips || room.initialChips;
    room.smallBlind = smallBlind !== undefined ? smallBlind : room.smallBlind;
    room.bigBlind = bigBlind !== undefined ? bigBlind : room.bigBlind;
    room.minBet = minBet !== undefined ? minBet : room.minBet;
    room.maxBet = maxBet !== undefined ? maxBet : room.maxBet;
    room.maxSwap = maxSwap !== undefined ? maxSwap : room.maxSwap;
    emitState(code);
  });

  socket.on('startGame', ({ code }, cb) => {
    const room = getRoom(code);
    if (!room) return cb({ ok: false, err: 'Stanza non trovata' });
    const p = getPlayerBySocket(room, socket.id);
    if (!p || p.id !== room.hostId) return cb({ ok: false, err: 'Non autorizzato' });
    if (room.players.length < 2) return cb({ ok: false, err: 'Servono almeno 2 giocatori' });
    room.started = true;
    room.players.forEach(pl => { pl.chips = room.initialChips; });
    startNewHand(room);
    emitState(code);
    cb({ ok: true });
  });

  function startNewHand(room) {
    room.handNum++;
    room.pot = 0;
    room.currentBet = 0;
    room.betsThisRound = {};
    room.communityCards = [];
    room.dealerCard = null;
    room.dealerCards = [];
    room.deck = makeDeck();
    room.players.forEach(pl => {
      pl.folded = false;
      pl.stood = false;
      pl.busted = false;
      pl.hasBlackjack = false;
      pl.swapped = false;
      pl.lastAction = '';
      pl.bjBet = 0;
      pl.cards = [];
    });

    if (room.gameType === 'texasholdem') {
      room.phase = 'preflop';
      if (room.cardMode === 'virtual') {
        room.players.forEach(pl => {
          if (pl.chips > 0) {
            pl.cards = [room.deck.pop(), room.deck.pop()];
          }
        });
      }
    } else if (room.gameType === 'blackjack') {
      room.phase = 'betting';
      if (room.cardMode === 'virtual') {
        room.dealerCards = [room.deck.pop(), room.deck.pop()];
        room.dealerCard = room.dealerCards[0];
      }
    } else if (room.gameType === '5carddraw') {
      room.phase = 'firstbet';
      if (room.cardMode === 'virtual') {
        room.players.forEach(pl => {
          if (pl.chips > 0) {
            pl.cards = [];
            for (let i = 0; i < 5; i++) pl.cards.push(room.deck.pop());
          }
        });
      }
    }
  }

  socket.on('action', ({ code, action, amount }, cb) => {
    const room = getRoom(code);
    if (!room || !room.started) return cb({ ok: false, err: 'Gioco non avviato' });
    const player = getPlayerBySocket(room, socket.id);
    if (!player) return cb({ ok: false, err: 'Non trovato' });
    amount = parseInt(amount) || 0;

    if (room.gameType === 'texasholdem' || room.gameType === '5carddraw') {
      if (player.folded || player.chips <= 0) return cb({ ok: false, err: 'Non puoi agire' });
      const myBet = room.betsThisRound[player.id] || 0;
      const toCall = room.currentBet - myBet;

      if (action === 'fold') {
        player.folded = true;
        player.lastAction = 'Fold';
      } else if (action === 'check') {
        if (toCall > 0) return cb({ ok: false, err: 'Non puoi check, devi call' });
        player.lastAction = 'Check';
      } else if (action === 'call') {
        const callAmt = Math.min(toCall, player.chips);
        player.chips -= callAmt;
        room.pot += callAmt;
        room.betsThisRound[player.id] = myBet + callAmt;
        player.lastAction = 'Call ' + callAmt.toLocaleString('it');
      } else if (action === 'bet') {
        if (amount <= 0 || amount > player.chips) return cb({ ok: false, err: 'Importo non valido' });
        player.chips -= amount;
        room.pot += amount;
        room.currentBet = (room.betsThisRound[player.id] || 0) + amount;
        room.betsThisRound[player.id] = room.currentBet;
        player.lastAction = 'Bet ' + amount.toLocaleString('it');
      } else if (action === 'raise') {
        if (amount <= 0 || amount > player.chips) return cb({ ok: false, err: 'Importo non valido' });
        const totalPut = toCall + amount;
        if (totalPut > player.chips) return cb({ ok: false, err: 'Fiches insufficienti' });
        player.chips -= totalPut;
        room.pot += totalPut;
        room.betsThisRound[player.id] = myBet + totalPut;
        room.currentBet = room.betsThisRound[player.id];
        player.lastAction = 'Raise ' + amount.toLocaleString('it');
      } else if (action === 'allin') {
        const allAmt = player.chips;
        room.pot += allAmt;
        room.betsThisRound[player.id] = (room.betsThisRound[player.id] || 0) + allAmt;
        if (room.betsThisRound[player.id] > room.currentBet) room.currentBet = room.betsThisRound[player.id];
        player.chips = 0;
        player.lastAction = 'All-in ' + allAmt.toLocaleString('it');
      } else {
        return cb({ ok: false, err: 'Azione non valida' });
      }
    } else if (room.gameType === 'blackjack') {
      if (room.phase === 'betting') {
        if (action === 'bjbet') {
          if (amount < room.minBet || amount > room.maxBet) return cb({ ok: false, err: `Puntata tra ${room.minBet.toLocaleString('it')} e ${room.maxBet.toLocaleString('it')}` });
          if (amount > player.chips) return cb({ ok: false, err: 'Fiches insufficienti' });
          player.chips -= amount;
          player.bjBet = amount;
          room.pot += amount;
          player.lastAction = 'Bet ' + amount.toLocaleString('it');
          if (room.cardMode === 'virtual') {
            if (player.cards.length === 0) {
              player.cards = [room.deck.pop(), room.deck.pop()];
              const t = bjTotal(player.cards);
              if (t === 21) player.hasBlackjack = true;
            }
          }
        }
      } else if (room.phase === 'playing') {
        if (player.stood || player.busted || player.bjBet === 0) return cb({ ok: false, err: 'Non puoi agire' });
        if (action === 'hit') {
          if (room.cardMode === 'virtual') {
            player.cards.push(room.deck.pop());
            const t = bjTotal(player.cards);
            if (t > 21) { player.busted = true; player.lastAction = 'Bust!'; }
            else if (t === 21) { player.stood = true; player.lastAction = 'Stand (21)'; }
            else { player.lastAction = 'Hit'; }
          } else {
            player.lastAction = 'Hit';
          }
        } else if (action === 'stand') {
          player.stood = true;
          player.lastAction = 'Stand';
        } else if (action === 'doubledown') {
          if (player.bjBet > player.chips) return cb({ ok: false, err: 'Fiches insufficienti per raddoppiare' });
          player.chips -= player.bjBet;
          room.pot += player.bjBet;
          player.bjBet *= 2;
          if (room.cardMode === 'virtual') {
            player.cards.push(room.deck.pop());
            const t = bjTotal(player.cards);
            if (t > 21) { player.busted = true; player.lastAction = 'Double Down - Bust!'; }
            else { player.lastAction = 'Double Down'; }
          } else {
            player.lastAction = 'Double Down';
          }
          player.stood = true;
        } else if (action === 'surrender') {
          const half = Math.floor(player.bjBet / 2);
          player.chips += half;
          room.pot -= half;
          player.stood = true;
          player.folded = true;
          player.lastAction = 'Surrender';
        } else {
          return cb({ ok: false, err: 'Azione non valida' });
        }
      }
    }

    emitState(code);
    cb({ ok: true });
  });

  socket.on('swapCards', ({ code, indices }, cb) => {
    const room = getRoom(code);
    if (!room || room.gameType !== '5carddraw' || room.phase !== 'swap') return cb({ ok: false, err: 'Non in fase di scambio' });
    const player = getPlayerBySocket(room, socket.id);
    if (!player || player.folded || player.swapped) return cb({ ok: false, err: 'Non puoi scambiare' });
    if (!Array.isArray(indices)) return cb({ ok: false, err: 'Indici non validi' });
    if (indices.length > room.maxSwap) return cb({ ok: false, err: `Puoi scambiare max ${room.maxSwap} carte` });

    if (room.cardMode === 'virtual') {
      for (const idx of indices) {
        if (idx >= 0 && idx < player.cards.length) {
          player.cards[idx] = room.deck.pop();
        }
      }
    }
    player.swapped = true;
    player.lastAction = indices.length === 0 ? 'Mantiene tutte' : `Scambia ${indices.length}`;
    emitState(code);
    cb({ ok: true });
  });

  socket.on('hostAdvancePhase', ({ code }, cb) => {
    const room = getRoom(code);
    if (!room) return cb({ ok: false, err: 'Stanza non trovata' });
    const p = getPlayerBySocket(room, socket.id);
    if (!p || p.id !== room.hostId) return cb({ ok: false, err: 'Non autorizzato' });

    if (room.gameType === 'texasholdem') {
      room.betsThisRound = {};
      room.currentBet = 0;
      room.players.forEach(pl => { if (!pl.folded) pl.lastAction = ''; });
      if (room.phase === 'preflop') {
        room.phase = 'flop';
        if (room.cardMode === 'virtual') {
          room.deck.pop();
          room.communityCards.push(room.deck.pop(), room.deck.pop(), room.deck.pop());
        }
      } else if (room.phase === 'flop') {
        room.phase = 'turn';
        if (room.cardMode === 'virtual') { room.deck.pop(); room.communityCards.push(room.deck.pop()); }
      } else if (room.phase === 'turn') {
        room.phase = 'river';
        if (room.cardMode === 'virtual') { room.deck.pop(); room.communityCards.push(room.deck.pop()); }
      }
    } else if (room.gameType === 'blackjack') {
      if (room.phase === 'betting') {
        room.phase = 'playing';
        room.players.forEach(pl => { if (pl.bjBet === 0) { pl.folded = true; } pl.lastAction = ''; });
      } else if (room.phase === 'playing') {
        room.phase = 'results';
        room.players.forEach(pl => { pl.lastAction = ''; });
      }
    } else if (room.gameType === '5carddraw') {
      room.betsThisRound = {};
      room.currentBet = 0;
      room.players.forEach(pl => { if (!pl.folded) pl.lastAction = ''; });
      if (room.phase === 'firstbet') {
        room.phase = 'swap';
      } else if (room.phase === 'swap') {
        room.phase = 'secondbet';
      } else if (room.phase === 'secondbet') {
        room.phase = 'showdown';
      }
    }
    emitState(code);
    cb({ ok: true });
  });

  socket.on('closeHand', ({ code, results }, cb) => {
    const room = getRoom(code);
    if (!room) return cb({ ok: false, err: 'Stanza non trovata' });
    const p = getPlayerBySocket(room, socket.id);
    if (!p || p.id !== room.hostId) return cb({ ok: false, err: 'Non autorizzato' });

    if (room.gameType === 'blackjack') {
      if (!results || !Array.isArray(results)) return cb({ ok: false, err: 'Risultati mancanti' });
      const winnerNames = [];
      for (const r of results) {
        const pl = room.players.find(x => x.id === r.id);
        if (!pl) continue;
        if (r.result === 'win') {
          pl.chips += pl.bjBet * 2;
          pl.lastAction = '✅ Vince!';
          winnerNames.push(pl.nickname);
        } else if (r.result === 'blackjack') {
          pl.chips += Math.floor(pl.bjBet * 2.5);
          pl.lastAction = '🎰 Blackjack!';
          winnerNames.push(pl.nickname + ' (BJ)');
        } else if (r.result === 'push') {
          pl.chips += pl.bjBet;
          pl.lastAction = '🤝 Push';
        } else {
          pl.lastAction = '❌ Perde';
        }
      }
      room.history.unshift({
        hand: room.handNum,
        winners: winnerNames.length > 0 ? winnerNames.join(', ') : 'Banco',
        pot: room.pot,
        time: new Date().toLocaleTimeString('it')
      });
    } else {
      if (!results || !Array.isArray(results) || results.length === 0) return cb({ ok: false, err: 'Seleziona almeno un vincitore' });
      const share = Math.floor(room.pot / results.length);
      const rem = room.pot % results.length;
      const winnerNames = [];
      results.forEach((rid, i) => {
        const pl = room.players.find(x => x.id === rid);
        if (pl) {
          pl.chips += share + (i === 0 ? rem : 0);
          winnerNames.push(pl.nickname);
        }
      });
      room.history.unshift({
        hand: room.handNum,
        winners: winnerNames.join(', '),
        pot: room.pot,
        time: new Date().toLocaleTimeString('it')
      });
    }

    room.pot = 0;
    startNewHand(room);
    emitState(code);
    cb({ ok: true });
  });

  socket.on('endSession', ({ code }, cb) => {
    const room = getRoom(code);
    if (!room) return cb({ ok: false, err: 'Stanza non trovata' });
    const p = getPlayerBySocket(room, socket.id);
    if (!p || p.id !== room.hostId) return cb({ ok: false, err: 'Non autorizzato' });
    const standings = room.players.map(pl => ({
      nickname: pl.nickname,
      chips: pl.chips,
      diff: pl.chips - room.initialChips,
      color: pl.color
    })).sort((a, b) => b.chips - a.chips);
    io.to(code).emit('sessionEnded', { standings });
    delete rooms[code];
    cb({ ok: true });
  });

  socket.on('disconnect', () => {
    if (!socket.data) return;
    const { code, nickname } = socket.data;
    const room = getRoom(code);
    if (!room) return;
    const p = getPlayerByNick(room, nickname);
    if (p) {
      p.connected = false;
      if (p.id === room.hostId) io.to(code).emit('hostPaused');
      emitState(code);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => console.log('Server on port ' + PORT));
