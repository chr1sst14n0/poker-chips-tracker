var express = require('express');
var app = express();
var http = require('http').createServer(app);
var io = require('socket.io')(http);
var path = require('path');
var PORT = process.env.PORT || 3000;

app.get('/', function(req, res) {
  res.sendFile(path.join(__dirname, 'index.html'));
});

var rooms = {};
var COLORS = ['#FF6B6B','#4ECDC4','#45B7D1','#FFA07A','#98D8C8','#F7DC6F','#BB8FCE','#85C1E2','#F8B739','#52B788'];
var CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function genCode() {
  var c = '';
  for (var i = 0; i < 6; i++) c += CHARS[Math.floor(Math.random() * CHARS.length)];
  return rooms[c] ? genCode() : c;
}

function mkDeck() {
  var suits = ['s','h','d','c'];
  var vals = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  var d = [];
  for (var i = 0; i < 4; i++)
    for (var j = 0; j < 13; j++)
      d.push({s: suits[i], v: vals[j]});
  for (var i = d.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = d[i]; d[i] = d[j]; d[j] = t;
  }
  return d;
}

function bjVal(cards) {
  var t = 0, a = 0;
  for (var i = 0; i < cards.length; i++) {
    var v = cards[i].v;
    if (v === 'A') { t += 11; a++; }
    else if (v === 'K' || v === 'Q' || v === 'J') t += 10;
    else t += parseInt(v);
  }
  while (t > 21 && a > 0) { t -= 10; a--; }
  return t;
}

function fp(r, sid) {
  for (var i = 0; i < r.players.length; i++)
    if (r.players[i].sid === sid) return r.players[i];
  return null;
}

function activeCount(r) {
  var c = 0;
  for (var i = 0; i < r.players.length; i++)
    if (!r.players[i].eliminated && r.players[i].chips > 0) c++;
  return c;
}

function newHand(r) {
  r.hn++;
  r.pot = 0;
  r.curBet = 0;
  r.rndBets = {};
  r.comCards = [];
  r.bankerCards = [];
  r.bankerRevealed = false;
  r.bankerDone = false;
  r.deck = mkDeck();

  for (var i = 0; i < r.players.length; i++) {
    var p = r.players[i];
    p.fold = false;
    p.stood = false;
    p.bust = false;
    p.hasBJ = false;
    p.swapped = false;
    p.act = '';
    p.bjBet = 0;
    p.cards = [];
    if (p.chips <= 0) p.eliminated = true;
  }

  if (r.gt === 'texas') {
    r.ph = 'preflop';
    if (r.cm === 'virtual') {
      for (var i = 0; i < r.players.length; i++) {
        if (!r.players[i].eliminated) {
          r.players[i].cards = [r.deck.pop(), r.deck.pop()];
        }
      }
    }
  } else if (r.gt === 'blackjack') {
    r.ph = 'betting';
  } else if (r.gt === 'draw') {
    r.ph = 'bet1';
    if (r.cm === 'virtual') {
      for (var i = 0; i < r.players.length; i++) {
        if (!r.players[i].eliminated) {
          r.players[i].cards = [];
          for (var j = 0; j < 5; j++) r.players[i].cards.push(r.deck.pop());
        }
      }
    }
  }
}

function sendState(code) {
  var r = rooms[code];
  if (!r) return;

  var pl = [];
  for (var i = 0; i < r.players.length; i++) {
    var p = r.players[i];
    pl.push({
      id: p.id, nick: p.nick, chips: p.chips, color: p.color,
      on: p.on, act: p.act, fold: p.fold, stood: p.stood,
      bust: p.bust, hasBJ: p.hasBJ, swapped: p.swapped,
      bjBet: p.bjBet, eliminated: p.eliminated,
      nc: p.cards ? p.cards.length : 0,
      bjt: (r.gt === 'blackjack' && p.cards) ? bjVal(p.cards) : 0
    });
  }

  var bankerVisible = [];
  if (r.gt === 'blackjack' && r.cm === 'virtual' && r.bankerCards.length > 0) {
    if (r.bankerRevealed) {
      bankerVisible = r.bankerCards.slice();
    } else {
      bankerVisible = [r.bankerCards[0]];
      for (var i = 1; i < r.bankerCards.length; i++) {
        bankerVisible.push({s: 'back', v: 'back'});
      }
    }
  }

  var bankerTotal = 0;
  if (r.gt === 'blackjack' && r.cm === 'virtual' && r.bankerCards.length > 0) {
    if (r.bankerRevealed) {
      bankerTotal = bjVal(r.bankerCards);
    } else {
      bankerTotal = bjVal([r.bankerCards[0]]);
    }
  }

  var base = {
    code: r.code, gt: r.gt, cm: r.cm, ic: r.ic,
    sb: r.sb, bb: r.bb, mn: r.mn, mx: r.mx, ms: r.ms,
    started: r.started, pot: r.pot, hn: r.hn, ph: r.ph,
    comCards: r.comCards,
    bankerCards: bankerVisible,
    bankerRevealed: r.bankerRevealed,
    bankerDone: r.bankerDone,
    bankerTotal: bankerTotal,
    hist: r.hist,
    players: pl,
    hostId: r.hid
  };

  for (var i = 0; i < r.players.length; i++) {
    var p = r.players[i];
    if (!p.sid) continue;
    var sk = io.sockets.sockets.get(p.sid);
    if (!sk) continue;
    sk.emit('gameState', {
      code: base.code, gt: base.gt, cm: base.cm, ic: base.ic,
      sb: base.sb, bb: base.bb, mn: base.mn, mx: base.mx, ms: base.ms,
      started: base.started, pot: base.pot, hn: base.hn, ph: base.ph,
      comCards: base.comCards,
      bankerCards: base.bankerCards,
      bankerRevealed: base.bankerRevealed,
      bankerDone: base.bankerDone,
      bankerTotal: base.bankerTotal,
      hist: base.hist,
      players: base.players,
      hostId: base.hostId,
      me: p.id,
      myCards: p.cards || [],
      isHost: p.id === r.hid
    });
  }
}

io.on('connection', function(socket) {
  console.log('connected: ' + socket.id);

  socket.on('createRoom', function(cb) {
    var code = genCode();
    rooms[code] = {
      code: code, hid: null, players: [],
      gt: 'texas', cm: 'physical', ic: 1000000,
      sb: 5000, bb: 10000, mn: 1000, mx: 100000, ms: 4,
      started: false, pot: 0, hn: 0, ph: 'wait',
      deck: [], comCards: [], bankerCards: [],
      bankerRevealed: false, bankerDone: false,
      curBet: 0, rndBets: {}, hist: [],
      blindIdx: 0
    };
    console.log('room created: ' + code);
    cb({ok: true, code: code});
  });

  socket.on('joinRoom', function(d, cb) {
    var r = rooms[d.code];
    if (!r) return cb({ok: false, err: 'Stanza non trovata'});
    var nick = (d.nick || '').trim();
    if (nick.length < 2 || nick.length > 12) return cb({ok: false, err: 'Nick: 2-12 caratteri'});

    var ex = null;
    for (var i = 0; i < r.players.length; i++)
      if (r.players[i].nick === nick) { ex = r.players[i]; break; }

    if (ex) {
      if (ex.on && ex.sid !== socket.id) {
        var s2 = io.sockets.sockets.get(ex.sid);
        if (s2) return cb({ok: false, err: 'Nick già in uso'});
      }
      ex.sid = socket.id;
      ex.on = true;
      socket.join(d.code);
      socket.data = {code: d.code, nick: nick};
      sendState(d.code);
      return cb({ok: true});
    }

    if (r.players.length >= 10) return cb({ok: false, err: 'Max 10 giocatori'});

    var pid = Math.random().toString(36).substr(2, 8);
    var pl = {
      id: pid, sid: socket.id, nick: nick,
      chips: 0, color: COLORS[r.players.length % 10],
      on: true, act: '', fold: false, stood: false,
      bust: false, hasBJ: false, swapped: false,
      bjBet: 0, cards: [], eliminated: false
    };

    if (r.players.length === 0) r.hid = pid;
    r.players.push(pl);
    socket.join(d.code);
    socket.data = {code: d.code, nick: nick};
    sendState(d.code);
    cb({ok: true});
  });

  socket.on('configure', function(d) {
    var r = rooms[d.code];
    if (!r || r.started) return;
    var p = fp(r, socket.id);
    if (!p || p.id !== r.hid) return;
    if (d.gt) r.gt = d.gt;
    if (d.cm) r.cm = d.cm;
    if (d.ic) r.ic = d.ic;
    if (d.sb !== undefined) r.sb = d.sb;
    if (d.bb !== undefined) r.bb = d.bb;
    if (d.mn !== undefined) r.mn = d.mn;
    if (d.mx !== undefined) r.mx = d.mx;
    if (d.ms !== undefined) r.ms = d.ms;
    sendState(d.code);
  });

  socket.on('startGame', function(d, cb) {
    var r = rooms[d.code];
    if (!r) return cb({ok: false, err: 'Stanza non trovata'});
    var p = fp(r, socket.id);
    if (!p || p.id !== r.hid) return cb({ok: false, err: 'Non autorizzato'});
    if (r.players.length < 2) return cb({ok: false, err: 'Servono almeno 2 giocatori'});
    r.started = true;
    for (var i = 0; i < r.players.length; i++) {
      r.players[i].chips = r.ic;
      r.players[i].eliminated = false;
    }
    newHand(r);
    sendState(d.code);
    cb({ok: true});
  });

  socket.on('playerAction', function(d, cb) {
    var r = rooms[d.code];
    if (!r || !r.started) return cb({ok: false, err: 'Partita non avviata'});
    var p = fp(r, socket.id);
    if (!p) return cb({ok: false, err: 'Giocatore non trovato'});
    if (p.eliminated) return cb({ok: false, err: 'Sei eliminato'});

    var amt = parseInt(d.amt) || 0;
    var act = d.act;

    if (r.gt === 'texas' || r.gt === 'draw') {
      if (p.fold || p.chips <= 0) return cb({ok: false, err: 'Non puoi agire'});
      var mb = r.rndBets[p.id] || 0;
      var tc = r.curBet - mb;

      if (act === 'fold') {
        p.fold = true;
        p.act = 'Fold';
      } else if (act === 'check') {
        if (tc > 0) return cb({ok: false, err: 'Devi fare Call o Fold'});
        p.act = 'Check';
      } else if (act === 'call') {
        var ca = Math.min(tc, p.chips);
        p.chips -= ca;
        r.pot += ca;
        r.rndBets[p.id] = mb + ca;
        p.act = 'Call ' + ca;
      } else if (act === 'bet') {
        if (amt <= 0 || amt > p.chips) return cb({ok: false, err: 'Importo non valido'});
        p.chips -= amt;
        r.pot += amt;
        r.curBet = mb + amt;
        r.rndBets[p.id] = r.curBet;
        p.act = 'Bet ' + amt;
      } else if (act === 'raise') {
        if (amt <= 0) return cb({ok: false, err: 'Importo non valido'});
        var tot = tc + amt;
        if (tot > p.chips) return cb({ok: false, err: 'Fiches insufficienti'});
        p.chips -= tot;
        r.pot += tot;
        r.rndBets[p.id] = mb + tot;
        r.curBet = r.rndBets[p.id];
        p.act = 'Raise ' + amt;
      } else if (act === 'allin') {
        var aa = p.chips;
        r.pot += aa;
        r.rndBets[p.id] = (r.rndBets[p.id] || 0) + aa;
        if (r.rndBets[p.id] > r.curBet) r.curBet = r.rndBets[p.id];
        p.chips = 0;
        p.act = 'All-in ' + aa;
      } else {
        return cb({ok: false, err: 'Azione non valida'});
      }
    } else if (r.gt === 'blackjack') {
      if (r.ph === 'betting') {
        if (act === 'bjbet') {
          if (amt < r.mn || amt > r.mx) return cb({ok: false, err: 'Puntata: ' + r.mn + ' - ' + r.mx});
          if (amt > p.chips) return cb({ok: false, err: 'Fiches insufficienti'});
          p.chips -= amt;
          p.bjBet = amt;
          r.pot += amt;
          p.act = 'Bet ' + amt;
        }
      } else if (r.ph === 'playing') {
        if (p.stood || p.bust || p.bjBet === 0 || p.fold) return cb({ok: false, err: 'Non puoi agire'});
        if (act === 'hit') {
          if (r.cm === 'virtual') {
            p.cards.push(r.deck.pop());
            var sc = bjVal(p.cards);
            if (sc > 21) { p.bust = true; p.act = 'Bust!'; }
            else if (sc === 21) { p.stood = true; p.act = '21!'; }
            else p.act = 'Hit';
          } else {
            p.act = 'Hit';
          }
        } else if (act === 'stand') {
          p.stood = true;
          p.act = 'Stand';
        } else if (act === 'double') {
          if (p.bjBet > p.chips) return cb({ok: false, err: 'Fiches insufficienti per raddoppiare'});
          p.chips -= p.bjBet;
          r.pot += p.bjBet;
          p.bjBet *= 2;
          if (r.cm === 'virtual') {
            p.cards.push(r.deck.pop());
            if (bjVal(p.cards) > 21) { p.bust = true; p.act = 'Double Bust!'; }
            else p.act = 'Double Down';
          } else {
            p.act = 'Double Down';
          }
          p.stood = true;
        } else if (act === 'surrender') {
          var half = Math.floor(p.bjBet / 2);
          p.chips += half;
          r.pot -= half;
          p.stood = true;
          p.fold = true;
          p.act = 'Surrender';
        }
      }
    }
    sendState(d.code);
    cb({ok: true});
  });

  socket.on('swapCards', function(d, cb) {
    var r = rooms[d.code];
    if (!r || r.gt !== 'draw' || r.ph !== 'swap') return cb({ok: false, err: 'Non in fase scambio'});
    var p = fp(r, socket.id);
    if (!p || p.fold || p.swapped || p.eliminated) return cb({ok: false, err: 'Non puoi scambiare'});
    var idx = d.idx;
    if (!Array.isArray(idx)) return cb({ok: false, err: 'Dati non validi'});
    if (idx.length > r.ms) return cb({ok: false, err: 'Max ' + r.ms + ' carte'});
    if (r.cm === 'virtual') {
      for (var i = 0; i < idx.length; i++) {
        if (idx[i] >= 0 && idx[i] < p.cards.length) {
          p.cards[idx[i]] = r.deck.pop();
        }
      }
    }
    p.swapped = true;
    p.act = idx.length === 0 ? 'Mantiene tutte' : 'Scambia ' + idx.length;
    sendState(d.code);
    cb({ok: true});
  });

  socket.on('advancePhase', function(d, cb) {
    var r = rooms[d.code];
    if (!r) return cb({ok: false, err: 'Stanza non trovata'});
    var p = fp(r, socket.id);
    if (!p || p.id !== r.hid) return cb({ok: false, err: 'Non autorizzato'});

    if (r.gt === 'texas') {
      r.rndBets = {};
      r.curBet = 0;
      for (var i = 0; i < r.players.length; i++) {
        if (!r.players[i].fold && !r.players[i].eliminated) r.players[i].act = '';
      }
      if (r.ph === 'preflop') {
        r.ph = 'flop';
        if (r.cm === 'virtual') {
          r.deck.pop();
          r.comCards.push(r.deck.pop(), r.deck.pop(), r.deck.pop());
        }
      } else if (r.ph === 'flop') {
        r.ph = 'turn';
        if (r.cm === 'virtual') {
          r.deck.pop();
          r.comCards.push(r.deck.pop());
        }
      } else if (r.ph === 'turn') {
        r.ph = 'river';
        if (r.cm === 'virtual') {
          r.deck.pop();
          r.comCards.push(r.deck.pop());
        }
      }
    } else if (r.gt === 'blackjack') {
      if (r.ph === 'betting') {
        r.ph = 'playing';
        for (var i = 0; i < r.players.length; i++) {
          if (r.players[i].bjBet === 0 && !r.players[i].eliminated) {
            r.players[i].fold = true;
          }
          r.players[i].act = '';
        }
        if (r.cm === 'virtual') {
          for (var i = 0; i < r.players.length; i++) {
            if (!r.players[i].fold && !r.players[i].eliminated && r.players[i].cards.length === 0) {
              r.players[i].cards = [r.deck.pop(), r.deck.pop()];
              if (bjVal(r.players[i].cards) === 21) r.players[i].hasBJ = true;
            }
          }
          r.bankerCards = [r.deck.pop(), r.deck.pop()];
          r.bankerRevealed = false;
          r.bankerDone = false;
        }
      } else if (r.ph === 'playing') {
        r.ph = 'banker';
        for (var i = 0; i < r.players.length; i++) r.players[i].act = '';
      } else if (r.ph === 'banker') {
        r.ph = 'results';
      }
    } else if (r.gt === 'draw') {
      r.rndBets = {};
      r.curBet = 0;
      for (var i = 0; i < r.players.length; i++) {
        if (!r.players[i].fold && !r.players[i].eliminated) r.players[i].act = '';
      }
      if (r.ph === 'bet1') r.ph = 'swap';
      else if (r.ph === 'swap') r.ph = 'bet2';
      else if (r.ph === 'bet2') r.ph = 'showdown';
    }

    sendState(d.code);
    cb({ok: true});
  });

  socket.on('bankerReveal', function(d, cb) {
    var r = rooms[d.code];
    if (!r || r.gt !== 'blackjack') return cb({ok: false, err: 'Non valido'});
    var p = fp(r, socket.id);
    if (!p || p.id !== r.hid) return cb({ok: false, err: 'Non autorizzato'});
    r.bankerRevealed = true;
    sendState(d.code);
    cb({ok: true});
  });

  socket.on('bankerHit', function(d, cb) {
    var r = rooms[d.code];
    if (!r || r.gt !== 'blackjack' || r.cm !== 'virtual') return cb({ok: false, err: 'Non valido'});
    var p = fp(r, socket.id);
    if (!p || p.id !== r.hid) return cb({ok: false, err: 'Non autorizzato'});
    if (r.bankerDone) return cb({ok: false, err: 'Banco fermato'});
    r.bankerCards.push(r.deck.pop());
    if (bjVal(r.bankerCards) > 21) r.bankerDone = true;
    sendState(d.code);
    cb({ok: true});
  });

  socket.on('bankerStand', function(d, cb) {
    var r = rooms[d.code];
    if (!r || r.gt !== 'blackjack') return cb({ok: false, err: 'Non valido'});
    var p = fp(r, socket.id);
    if (!p || p.id !== r.hid) return cb({ok: false, err: 'Non autorizzato'});
    r.bankerDone = true;
    sendState(d.code);
    cb({ok: true});
  });

  socket.on('closeHand', function(d, cb) {
    var r = rooms[d.code];
    if (!r) return cb({ok: false, err: 'Stanza non trovata'});
    var p = fp(r, socket.id);
    if (!p || p.id !== r.hid) return cb({ok: false, err: 'Non autorizzato'});
    var res = d.res;

    if (r.gt === 'blackjack') {
      if (!res || !Array.isArray(res)) return cb({ok: false, err: 'Risultati mancanti'});
      var wn = [];
      for (var i = 0; i < res.length; i++) {
        var pl = null;
        for (var j = 0; j < r.players.length; j++)
          if (r.players[j].id === res[i].id) { pl = r.players[j]; break; }
        if (!pl) continue;
        if (res[i].r === 'w') { pl.chips += pl.bjBet * 2; wn.push(pl.nick); }
        else if (res[i].r === 'bj') { pl.chips += Math.floor(pl.bjBet * 2.5); wn.push(pl.nick); }
        else if (res[i].r === 'p') { pl.chips += pl.bjBet; }
      }
      r.hist.unshift({h: r.hn, w: wn.length ? wn.join(', ') : 'Banco', p: r.pot, t: new Date().toLocaleTimeString('it')});
    } else {
      if (!res || !Array.isArray(res) || !res.length) return cb({ok: false, err: 'Seleziona almeno un vincitore'});
      var share = Math.floor(r.pot / res.length);
      var rem = r.pot % res.length;
      var wn = [];
      for (var i = 0; i < res.length; i++) {
        for (var j = 0; j < r.players.length; j++) {
          if (r.players[j].id === res[i]) {
            r.players[j].chips += share + (i === 0 ? rem : 0);
            wn.push(r.players[j].nick);
          }
        }
      }
      r.hist.unshift({h: r.hn, w: wn.join(', '), p: r.pot, t: new Date().toLocaleTimeString('it')});
    }

    r.pot = 0;

    if (activeCount(r) < 2) {
      io.to(d.code).emit('fewPlayers');
    }

    newHand(r);
    sendState(d.code);
    cb({ok: true});
  });

  socket.on('endSession', function(d, cb) {
    var r = rooms[d.code];
    if (!r) return cb({ok: false, err: 'Stanza non trovata'});
    var p = fp(r, socket.id);
    if (!p || p.id !== r.hid) return cb({ok: false, err: 'Non autorizzato'});
    var st = [];
    for (var i = 0; i < r.players.length; i++) {
      var pl = r.players[i];
      st.push({nick: pl.nick, chips: pl.chips, diff: pl.chips - r.ic, color: pl.color});
    }
    st.sort(function(a, b) { return b.chips - a.chips; });
    io.to(d.code).emit('sessionEnded', {st: st});
    delete rooms[d.code];
    cb({ok: true});
  });

  socket.on('disconnect', function() {
    if (!socket.data) return;
    var r = rooms[socket.data.code];
    if (!r) return;
    for (var i = 0; i < r.players.length; i++) {
      if (r.players[i].nick === socket.data.nick) {
        r.players[i].on = false;
        if (r.players[i].id === r.hid) io.to(r.code).emit('hostPaused');
        break;
      }
    }
    sendState(socket.data.code);
  });
});

http.listen(PORT, function() { console.log('Server OK on port ' + PORT); });
