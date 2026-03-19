const express = require('express');
const http = require('http');
const path = require('path');
const app = express();
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, {
  cors: { origin: '*' }
});
const PORT = process.env.PORT || 3000;

app.get('/', function(req, res) {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const rooms = {};
const SUITS = ['♠','♥','♦','♣'];
const VALUES = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const COLORS = ['#FF6B6B','#4ECDC4','#45B7D1','#FFA07A','#98D8C8','#F7DC6F','#BB8FCE','#85C1E2','#F8B739','#52B788'];
const SAFE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function makeCode() {
  var c = '';
  for (var i = 0; i < 6; i++) {
    c += SAFE_CHARS[Math.floor(Math.random() * SAFE_CHARS.length)];
  }
  if (rooms[c]) return makeCode();
  return c;
}

function makeDeck() {
  var d = [];
  for (var si = 0; si < SUITS.length; si++) {
    for (var vi = 0; vi < VALUES.length; vi++) {
      d.push({ suit: SUITS[si], value: VALUES[vi] });
    }
  }
  for (var i = d.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = d[i];
    d[i] = d[j];
    d[j] = tmp;
  }
  return d;
}

function bjTotal(cards) {
  var t = 0;
  var aces = 0;
  for (var i = 0; i < cards.length; i++) {
    var v = cards[i].value;
    if (v === 'A') { t += 11; aces++; }
    else if (v === 'K' || v === 'Q' || v === 'J') { t += 10; }
    else { t += parseInt(v); }
  }
  while (t > 21 && aces > 0) { t -= 10; aces--; }
  return t;
}

function emitState(code) {
  var room = rooms[code];
  if (!room) return;
  var basePlayers = [];
  for (var i = 0; i < room.players.length; i++) {
    var p = room.players[i];
    basePlayers.push({
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
    });
  }
  var base = {
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
    players: basePlayers
  };
  for (var i = 0; i < room.players.length; i++) {
    var p = room.players[i];
    if (p.sid) {
      var s = io.sockets.sockets.get(p.sid);
      if (s) {
        s.emit('state', {
          code: base.code,
          gameType: base.gameType,
          cardMode: base.cardMode,
          initialChips: base.initialChips,
          smallBlind: base.smallBlind,
          bigBlind: base.bigBlind,
          minBet: base.minBet,
          maxBet: base.maxBet,
          maxSwap: base.maxSwap,
          started: base.started,
          pot: base.pot,
          handNum: base.handNum,
          phase: base.phase,
          communityCards: base.communityCards,
          dealerCard: base.dealerCard,
          history: base.history,
          players: base.players,
          myId: p.id,
          myCards: p.cards || [],
          isHost: p.id === room.hostId
        });
      }
    }
  }
}

function startNewHand(room) {
  room.handNum++;
  room.pot = 0;
  room.currentBet = 0;
  room.betsThisRound = {};
  room.communityCards = [];
  room.dealerCard = null;
  room.dealerCards = [];
  room.deck = makeDeck();
  for (var i = 0; i < room.players.length; i++) {
    var pl = room.players[i];
    pl.folded = false;
    pl.stood = false;
    pl.busted = false;
    pl.hasBlackjack = false;
    pl.swapped = false;
    pl.lastAction = '';
    pl.bjBet = 0;
    pl.cards = [];
  }
  if (room.gameType === 'texasholdem') {
    room.phase = 'preflop';
    if (room.cardMode === 'virtual') {
      for (var i = 0; i < room.players.length; i++) {
        if (room.players[i].chips > 0) {
          room.players[i].cards = [room.deck.pop(), room.deck.pop()];
        }
      }
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
      for (var i = 0; i < room.players.length; i++) {
        if (room.players[i].chips > 0) {
          room.players[i].cards = [];
          for (var j = 0; j < 5; j++) {
            room.players[i].cards.push(room.deck.pop());
          }
        }
      }
    }
  }
}

io.on('connection', function(socket) {
  console.log('Connected: ' + socket.id);

  socket.on('createRoom', function(cb) {
    var code = makeCode();
    rooms[code] = {
      code: code,
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
    console.log('Room created: ' + code);
    cb({ ok: true, code: code });
  });

  socket.on('joinRoom', function(data, cb) {
    var code = data.code;
    var nickname = data.nickname;
    var room = rooms[code];
    if (!room) return cb({ ok: false, err: 'Stanza non trovata' });
    if (nickname.length < 2 || nickname.length > 12) return cb({ ok: false, err: 'Nickname: 2-12 caratteri' });

    var existing = null;
    for (var i = 0; i < room.players.length; i++) {
      if (room.players[i].nickname === nickname) {
        existing = room.players[i];
        break;
      }
    }

    if (existing) {
      if (existing.connected && existing.sid !== socket.id) {
        var existingSocket = io.sockets.sockets.get(existing.sid);
        if (existingSocket) return cb({ ok: false, err: 'Nickname già in uso' });
      }
      existing.sid = socket.id;
      existing.connected = true;
      socket.join(code);
      socket.data = { code: code, nickname: nickname };
      emitState(code);
      return cb({ ok: true });
    }

    if (room.players.length >= 10) return cb({ ok: false, err: 'Stanza piena (max 10)' });

    var pid = Math.random().toString(36).substring(2, 10);
    var player = {
      id: pid,
      sid: socket.id,
      nickname: nickname,
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
    socket.data = { code: code, nickname: nickname };
    console.log(nickname + ' joined room ' + code);
    emitState(code);
    cb({ ok: true });
  });

  socket.on('configure', function(data) {
    var room = rooms[data.code];
    if (!room || room.started) return;
    var p = null;
    for (var i = 0; i < room.players.length; i++) {
      if (room.players[i].sid === socket.id) { p = room.players[i]; break; }
    }
    if (!p || p.id !== room.hostId) return;
    if (data.gameType) room.gameType = data.gameType;
    if (data.cardMode) room.cardMode = data.cardMode;
    if (data.initialChips) room.initialChips = data.initialChips;
    if (data.smallBlind !== undefined) room.smallBlind = data.smallBlind;
    if (data.bigBlind !== undefined) room.bigBlind = data.bigBlind;
    if (data.minBet !== undefined) room.minBet = data.minBet;
    if (data.maxBet !== undefined) room.maxBet = data.maxBet;
    if (data.maxSwap !== undefined) room.maxSwap = data.maxSwap;
    emitState(data.code);
  });

  socket.on('startGame', function(data, cb) {
    var room = rooms[data.code];
    if (!room) return cb({ ok: false, err: 'Stanza non trovata' });
    var p = null;
    for (var i = 0; i < room.players.length; i++) {
      if (room.players[i].sid === socket.id) { p = room.players[i]; break; }
    }
    if (!p || p.id !== room.hostId) return cb({ ok: false, err: 'Non autorizzato' });
    if (room.players.length < 2) return cb({ ok: false, err: 'Servono almeno 2 giocatori' });
    room.started = true;
    for (var i = 0; i < room.players.length; i++) {
      room.players[i].chips = room.initialChips;
    }
    startNewHand(room);
    emitState(data.code);
    cb({ ok: true });
  });

  socket.on('action', function(data, cb) {
    var room = rooms[data.code];
    if (!room || !room.started) return cb({ ok: false, err: 'Gioco non avviato' });
    var player = null;
    for (var i = 0; i < room.players.length; i++) {
      if (room.players[i].sid === socket.id) { player = room.players[i]; break; }
    }
    if (!player) return cb({ ok: false, err: 'Non trovato' });
    var amount = parseInt(data.amount) || 0;
    var action = data.action;

    if (room.gameType === 'texasholdem' || room.gameType === '5carddraw') {
      if (player.folded || player.chips <= 0) return cb({ ok: false, err: 'Non puoi agire' });
      var myBet = room.betsThisRound[player.id] || 0;
      var toCall = room.currentBet - myBet;

      if (action === 'fold') {
        player.folded = true;
        player.lastAction = 'Fold';
      } else if (action === 'check') {
        if (toCall > 0) return cb({ ok: false, err: 'Devi fare Call o Fold' });
        player.lastAction = 'Check';
      } else if (action === 'call') {
        var callAmt = Math.min(toCall, player.chips);
        player.chips -= callAmt;
        room.pot += callAmt;
        room.betsThisRound[player.id] = myBet + callAmt;
        player.lastAction = 'Call ' + callAmt.toLocaleString('it');
      } else if (action === 'bet') {
        if (amount <= 0 || amount > player.chips) return cb({ ok: false, err: 'Importo non valido' });
        player.chips -= amount;
        room.pot += amount;
        room.currentBet = myBet + amount;
        room.betsThisRound[player.id] = room.currentBet;
        player.lastAction = 'Bet ' + amount.toLocaleString('it');
      } else if (action === 'raise') {
        if (amount <= 0 || amount > player.chips) return cb({ ok: false, err: 'Importo non valido' });
        var totalPut = toCall + amount;
        if (totalPut > player.chips) return cb({ ok: false, err: 'Fiches insufficienti' });
        player.chips -= totalPut;
        room.pot += totalPut;
        room.betsThisRound[player.id] = myBet + totalPut;
        room.currentBet = room.betsThisRound[player.id];
        player.lastAction = 'Raise ' + amount.toLocaleString('it');
      } else if (action === 'allin') {
        var allAmt = player.chips;
        room.pot += allAmt;
        room.betsThisRound[player.id] = (room.betsThisRound[player.id] || 0) + allAmt;
        if (room.betsThisRound[player.id] > room.currentBet) {
          room.currentBet = room.betsThisRound[player.id];
        }
        player.chips = 0;
        player.lastAction = 'All-in ' + allAmt.toLocaleString('it');
      } else {
        return cb({ ok: false, err: 'Azione non valida' });
      }
    } else if (room.gameType === 'blackjack') {
      if (room.phase === 'betting') {
        if (action === 'bjbet') {
          if (amount < room.minBet || amount > room.maxBet) return cb({ ok: false, err: 'Puntata tra ' + room.minBet.toLocaleString('it') + ' e ' + room.maxBet.toLocaleString('it') });
          if (amount > player.chips) return cb({ ok: false, err: 'Fiches insufficienti' });
          player.chips -= amount;
          player.bjBet = amount;
          room.pot += amount;
          player.lastAction = 'Bet ' + amount.toLocaleString('it');
          if (room.cardMode === 'virtual' && player.cards.length === 0) {
            player.cards = [room.deck.pop(), room.deck.pop()];
            if (bjTotal(player.cards) === 21) player.hasBlackjack = true;
          }
        }
      } else if (room.phase === 'playing') {
        if (player.stood || player.busted || player.bjBet === 0) return cb({ ok: false, err: 'Non puoi agire' });
        if (action === 'hit') {
          if (room.cardMode === 'virtual') {
            player.cards.push(room.deck.pop());
            var t = bjTotal(player.cards);
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
          if (player.bjBet > player.chips) return cb({ ok: false, err: 'Fiches insufficienti' });
          player.chips -= player.bjBet;
          room.pot += player.bjBet;
          player.bjBet = player.bjBet * 2;
          if (room.cardMode === 'virtual') {
            player.cards.push(room.deck.pop());
            var t = bjTotal(player.cards);
            if (t > 21) { player.busted = true; player.lastAction = 'Double - Bust!'; }
            else { player.lastAction = 'Double Down'; }
          } else {
            player.lastAction = 'Double Down';
          }
          player.stood = true;
        } else if (action === 'surrender') {
          var half = Math.floor(player.bjBet / 2);
          player.chips += half;
          room.pot -= half;
          player.stood = true;
          player.folded = true;
          player.lastAction = 'Surrender';
        }
      }
    }

    emitState(data.code);
    cb({ ok: true });
  });

  socket.on('swapCards', function(data, cb) {
    var room = rooms[data.code];
    if (!room || room.gameType !== '5carddraw' || room.phase !== 'swap') return cb({ ok: false, err: 'Non in fase scambio' });
    var player = null;
    for (var i = 0; i < room.players.length; i++) {
      if (room.players[i].sid === socket.id) { player = room.players[i]; break; }
    }
    if (!player || player.folded || player.swapped) return cb({ ok: false, err: 'Non puoi scambiare' });
    var indices = data.indices;
    if (!Array.isArray(indices)) return cb({ ok: false, err: 'Dati non validi' });
    if (indices.length > room.maxSwap) return cb({ ok: false, err: 'Max ' + room.maxSwap + ' carte' });
    if (room.cardMode === 'virtual') {
      for (var i = 0; i < indices.length; i++) {
        var idx = indices[i];
        if (idx >= 0 && idx < player.cards.length) {
          player.cards[idx] = room.deck.pop();
        }
      }
    }
    player.swapped = true;
    player.lastAction = indices.length === 0 ? 'Mantiene tutte' : 'Scambia ' + indices.length;
    emitState(data.code);
    cb({ ok: true });
  });

  socket.on('hostAdvancePhase', function(data, cb) {
    var room = rooms[data.code];
    if (!room) return cb({ ok: false, err: 'Stanza non trovata' });
    var p = null;
    for (var i = 0; i < room.players.length; i++) {
      if (room.players[i].sid === socket.id) { p = room.players[i]; break; }
    }
    if (!p || p.id !== room.hostId) return cb({ ok: false, err: 'Non autorizzato' });

    if (room.gameType === 'texasholdem') {
      room.betsThisRound = {};
      room.currentBet = 0;
      for (var i = 0; i < room.players.length; i++) {
        if (!room.players[i].folded) room.players[i].lastAction = '';
      }
      if (room.phase === 'preflop') {
        room.phase = 'flop';
        if (room.cardMode === 'virtual') {
          room.deck.pop();
          room.communityCards.push(room.deck.pop(), room.deck.pop(), room.deck.pop());
        }
      } else if (room.phase === 'flop') {
        room.phase = 'turn';
        if (room.cardMode === 'virtual') {
          room.deck.pop();
          room.communityCards.push(room.deck.pop());
        }
      } else if (room.phase === 'turn') {
        room.phase = 'river';
        if (room.cardMode === 'virtual') {
          room.deck.pop();
          room.communityCards.push(room.deck.pop());
        }
      }
    } else if (room.gameType === 'blackjack') {
      if (room.phase === 'betting') {
        room.phase = 'playing';
        for (var i = 0; i < room.players.length; i++) {
          if (room.players[i].bjBet === 0) room.players[i].folded = true;
          room.players[i].lastAction = '';
        }
      } else if (room.phase === 'playing') {
        room.phase = 'results';
        for (var i = 0; i < room.players.length; i++) {
          room.players[i].lastAction = '';
        }
      }
    } else if (room.gameType === '5carddraw') {
      room.betsThisRound = {};
      room.currentBet = 0;
      for (var i = 0; i < room.players.length; i++) {
        if (!room.players[i].folded) room.players[i].lastAction = '';
      }
      if (room.phase === 'firstbet') {
        room.phase = 'swap';
      } else if (room.phase === 'swap') {
        room.phase = 'secondbet';
      } else if (room.phase === 'secondbet') {
        room.phase = 'showdown';
      }
    }
    emitState(data.code);
    cb({ ok: true });
  });

  socket.on('closeHand', function(data, cb) {
    var room = rooms[data.code];
    if (!room) return cb({ ok: false, err: 'Stanza non trovata' });
    var p = null;
    for (var i = 0; i < room.players.length; i++) {
      if (room.players[i].sid === socket.id) { p = room.players[i]; break; }
    }
    if (!p || p.id !== room.hostId) return cb({ ok: false, err: 'Non autorizzato' });

    var results = data.results;

    if (room.gameType === 'blackjack') {
      if (!results || !Array.isArray(results)) return cb({ ok: false, err: 'Risultati mancanti' });
      var winnerNames = [];
      for (var i = 0; i < results.length; i++) {
        var r = results[i];
        var pl = null;
        for (var j = 0; j < room.players.length; j++) {
          if (room.players[j].id === r.id) { pl = room.players[j]; break; }
        }
        if (!pl) continue;
        if (r.result === 'win') {
          pl.chips += pl.bjBet * 2;
          pl.lastAction = 'Vince!';
          winnerNames.push(pl.nickname);
        } else if (r.result === 'blackjack') {
          pl.chips += Math.floor(pl.bjBet * 2.5);
          pl.lastAction = 'Blackjack!';
          winnerNames.push(pl.nickname + ' (BJ)');
        } else if (r.result === 'push') {
          pl.chips += pl.bjBet;
          pl.lastAction = 'Push';
        } else {
          pl.lastAction = 'Perde';
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
      var share = Math.floor(room.pot / results.length);
      var rem = room.pot % results.length;
      var winnerNames = [];
      for (var i = 0; i < results.length; i++) {
        var pl = null;
        for (var j = 0; j < room.players.length; j++) {
          if (room.players[j].id === results[i]) { pl = room.players[j]; break; }
        }
        if (pl) {
          pl.chips += share + (i === 0 ? rem : 0);
          winnerNames.push(pl.nickname);
        }
      }
      room.history.unshift({
        hand: room.handNum,
        winners: winnerNames.join(', '),
        pot: room.pot,
       
