const express = require('express');
const http = require('http');
const path = require('path');
const app = express();
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.get('/', function(req, res) {
  res.sendFile(path.join(__dirname, 'index.html'));
});

var rooms = {};
var SUITS = ['s','h','d','c'];
var VALS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
var COLORS = ['#FF6B6B','#4ECDC4','#45B7D1','#FFA07A','#98D8C8','#F7DC6F','#BB8FCE','#85C1E2','#F8B739','#52B788'];
var CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function makeCode() {
  var c = '';
  for (var i = 0; i < 6; i++) c += CHARS[Math.floor(Math.random() * CHARS.length)];
  return rooms[c] ? makeCode() : c;
}

function makeDeck() {
  var d = [];
  for (var i = 0; i < SUITS.length; i++)
    for (var j = 0; j < VALS.length; j++)
      d.push({ s: SUITS[i], v: VALS[j] });
  for (var i = d.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = d[i]; d[i] = d[j]; d[j] = t;
  }
  return d;
}

function bjScore(cards) {
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

function sendState(code) {
  var r = rooms[code];
  if (!r) return;
  var plist = [];
  for (var i = 0; i < r.players.length; i++) {
    var p = r.players[i];
    plist.push({
      id: p.id, nick: p.nick, chips: p.chips, color: p.color,
      on: p.on, act: p.act, fold: p.fold, stood: p.stood,
      bust: p.bust, hasBJ: p.hasBJ, swapped: p.swapped,
      bjBet: p.bjBet, nc: p.cards ? p.cards.length : 0,
      bjT: (r.gt === 'bj' && p.cards) ? bjScore(p.cards) : 0
    });
  }
  var base = {
    code: r.code, gt: r.gt, cm: r.cm, ic: r.ic,
    sb: r.sb, bb: r.bb, mn: r.mn, mx: r.mx, ms: r.ms,
    on: r.on, pot: r.pot, hn: r.hn, ph: r.ph,
    cc: r.cc, dc: r.dc, hist: r.hist, players: plist
  };
  for (var i = 0; i < r.players.length; i++) {
    var p = r.players[i];
    if (p.sid) {
      var sk = io.sockets.sockets.get(p.sid);
      if (sk) {
        sk.emit('S', {
          code: base.code, gt: base.gt, cm: base.cm, ic: base.ic,
          sb: base.sb, bb: base.bb, mn: base.mn, mx: base.mx, ms: base.ms,
          on: base.on, pot: base.pot, hn: base.hn, ph: base.ph,
          cc: base.cc, dc: base.dc, hist: base.hist, players: base.players,
          me: p.id, myC: p.cards || [], host: p.id === r.hid
        });
      }
    }
  }
}

function newHand(r) {
  r.hn++;
  r.pot = 0;
  r.cb = 0;
  r.bets = {};
  r.cc = [];
  r.dc = null;
  r.dcs = [];
  r.deck = makeDeck();
  for (var i = 0; i < r.players.length; i++) {
    var p = r.players[i];
    p.fold = false; p.stood = false; p.bust = false;
    p.hasBJ = false; p.swapped = false; p.act = '';
    p.bjBet = 0; p.cards = [];
  }
  if (r.gt === 'th') {
    r.ph = 'preflop';
    if (r.cm === 'v') {
      for (var i = 0; i < r.players.length; i++)
        if (r.players[i].chips > 0)
          r.players[i].cards = [r.deck.pop(), r.deck.pop()];
    }
  } else if (r.gt === 'bj') {
    r.ph = 'bet';
    if (r.cm === 'v') {
      r.dcs = [r.deck.pop(), r.deck.pop()];
      r.dc = r.dcs[0];
    }
  } else if (r.gt === 'dr') {
    r.ph = 'bet1';
    if (r.cm === 'v') {
      for (var i = 0; i < r.players.length; i++)
        if (r.players[i].chips > 0) {
          r.players[i].cards = [];
          for (var j = 0; j < 5; j++) r.players[i].cards.push(r.deck.pop());
        }
    }
  }
}

function findP(r, sid) {
  for (var i = 0; i < r.players.length; i++)
    if (r.players[i].sid === sid) return r.players[i];
  return null;
}

io.on('connection', function(socket) {

  socket.on('mk', function(cb) {
    var code = makeCode();
    rooms[code] = {
      code: code, hid: null, players: [],
      gt: 'th', cm: 'p', ic: 1000000,
      sb: 5000, bb: 10000, mn: 1000, mx: 100000, ms: 4,
      on: false, pot: 0, hn: 0, ph: 'w',
      deck: [], cc: [], dc: null, dcs: [],
      cb: 0, bets: {}, hist: []
    };
    cb({ ok: true, code: code });
  });

  socket.on('jn', function(d, cb) {
    var r = rooms[d.code];
    if (!r) return cb({ ok: false, e: 'Stanza non trovata' });
    var nick = (d.nick || '').trim();
    if (nick.length < 2 || nick.length > 12) return cb({ ok: false, e: 'Nick 2-12 char' });
    var ex = null;
    for (var i = 0; i < r.players.length; i++)
      if (r.players[i].nick === nick) { ex = r.players[i]; break; }
    if (ex) {
      if (ex.on && ex.sid !== socket.id) {
        var s2 = io.sockets.sockets.get(ex.sid);
        if (s2) return cb({ ok: false, e: 'Nick in uso' });
      }
      ex.sid = socket.id; ex.on = true;
      socket.join(d.code); socket.data = { code: d.code, nick: nick };
      sendState(d.code); return cb({ ok: true });
    }
    if (r.players.length >= 10) return cb({ ok: false, e: 'Max 10' });
    var pid = Math.random().toString(36).substr(2, 8);
    var pl = {
      id: pid, sid: socket.id, nick: nick,
      chips: 0, color: COLORS[r.players.length % 10],
      on: true, act: '', fold: false, stood: false,
      bust: false, hasBJ: false, swapped: false,
      bjBet: 0, cards: []
    };
    if (r.players.length === 0) r.hid = pid;
    r.players.push(pl);
    socket.join(d.code); socket.data = { code: d.code, nick: nick };
    sendState(d.code); cb({ ok: true });
  });

  socket.on('cfg', function(d) {
    var r = rooms[d.code];
    if (!r || r.on) return;
    var p = findP(r, socket.id);
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

  socket.on('go', function(d, cb) {
    var r = rooms[d.code];
    if (!r) return cb({ ok: false, e: 'No room' });
    var p = findP(r, socket.id);
    if (!p || p.id !== r.hid) return cb({ ok: false, e: 'No auth' });
    if (r.players.length < 2) return cb({ ok: false, e: 'Min 2' });
    r.on = true;
    for (var i = 0; i < r.players.length; i++) r.players[i].chips = r.ic;
    newHand(r); sendState(d.code); cb({ ok: true });
  });

  socket.on('act', function(d, cb) {
    var r = rooms[d.code];
    if (!r || !r.on) return cb({ ok: false, e: 'No game' });
    var p = findP(r, socket.id);
    if (!p) return cb({ ok: false, e: 'No player' });
    var amt = parseInt(d.amt) || 0;
    var a = d.a;

    if (r.gt === 'th' || r.gt === 'dr') {
      if (p.fold || p.chips <= 0) return cb({ ok: false, e: 'Cant act' });
      var mb = r.bets[p.id] || 0;
      var tc = r.cb - mb;
      if (a === 'fold') { p.fold = true; p.act = 'Fold'; }
      else if (a === 'check') {
        if (tc > 0) return cb({ ok: false, e: 'Must call' });
        p.act = 'Check';
      } else if (a === 'call') {
        var ca = Math.min(tc, p.chips);
        p.chips -= ca; r.pot += ca;
        r.bets[p.id] = mb + ca;
        p.act = 'Call ' + ca;
      } else if (a === 'bet') {
        if (amt <= 0 || amt > p.chips) return cb({ ok: false, e: 'Bad amt' });
        p.chips -= amt; r.pot += amt;
        r.cb = mb + amt; r.bets[p.id] = r.cb;
        p.act = 'Bet ' + amt;
      } else if (a === 'raise') {
        if (amt <= 0) return cb({ ok: false, e: 'Bad amt' });
        var tot = tc + amt;
        if (tot > p.chips) return cb({ ok: false, e: 'Not enough' });
        p.chips -= tot; r.pot += tot;
        r.bets[p.id] = mb + tot; r.cb = r.bets[p.id];
        p.act = 'Raise ' + amt;
      } else if (a === 'allin') {
        var aa = p.chips;
        r.pot += aa; r.bets[p.id] = (r.bets[p.id] || 0) + aa;
        if (r.bets[p.id] > r.cb) r.cb = r.bets[p.id];
        p.chips = 0; p.act = 'All-in ' + aa;
      } else return cb({ ok: false, e: 'Bad action' });
    } else if (r.gt === 'bj') {
      if (r.ph === 'bet') {
        if (a === 'bjbet') {
          if (amt < r.mn || amt > r.mx) return cb({ ok: false, e: 'Bet ' + r.mn + '-' + r.mx });
          if (amt > p.chips) return cb({ ok: false, e: 'Not enough' });
          p.chips -= amt; p.bjBet = amt; r.pot += amt;
          p.act = 'Bet ' + amt;
          if (r.cm === 'v' && p.cards.length === 0) {
            p.cards = [r.deck.pop(), r.deck.pop()];
            if (bjScore(p.cards) === 21) p.hasBJ = true;
          }
        }
      } else if (r.ph === 'play') {
        if (p.stood || p.bust || p.bjBet === 0) return cb({ ok: false, e: 'Cant' });
        if (a === 'hit') {
          if (r.cm === 'v') {
            p.cards.push(r.deck.pop());
            var t = bjScore(p.cards);
            if (t > 21) { p.bust = true; p.act = 'Bust!'; }
            else if (t === 21) { p.stood = true; p.act = '21!'; }
            else p.act = 'Hit';
          } else p.act = 'Hit';
        } else if (a === 'stand') { p.stood = true; p.act = 'Stand'; }
        else if (a === 'dbl') {
          if (p.bjBet > p.chips) return cb({ ok: false, e: 'Not enough' });
          p.chips -= p.bjBet; r.pot += p.bjBet; p.bjBet *= 2;
          if (r.cm === 'v') {
            p.cards.push(r.deck.pop());
            var t = bjScore(p.cards);
            if (t > 21) { p.bust = true; p.act = 'Dbl Bust!'; }
            else p.act = 'Double';
          } else p.act = 'Double';
          p.stood = true;
        } else if (a === 'surr') {
          var half = Math.floor(p.bjBet / 2);
          p.chips += half; r.pot -= half;
          p.stood = true; p.fold = true; p.act = 'Surrender';
        }
      }
    }
    sendState(d.code); cb({ ok: true });
  });

  socket.on('swap', function(d, cb) {
    var r = rooms[d.code];
    if (!r || r.gt !== 'dr' || r.ph !== 'swap') return cb({ ok: false, e: 'Not swap' });
    var p = findP(r, socket.id);
    if (!p || p.fold || p.swapped) return cb({ ok: false, e: 'Cant' });
    var idx = d.idx;
    if (!Array.isArray(idx)) return cb({ ok: false, e: 'Bad data' });
    if (idx.length > r.ms) return cb({ ok: false, e: 'Max ' + r.ms });
    if (r.cm === 'v') {
      for (var i = 0; i < idx.length; i++) {
        var x = idx[i];
        if (x >= 0 && x < p.cards.length) p.cards[x] = r.deck.pop();
      }
    }
    p.swapped = true;
    p.act = idx.length === 0 ? 'Keep all' : 'Swap ' + idx.length;
    sendState(d.code); cb({ ok: true });
  });

  socket.on('adv', function(d, cb) {
    var r = rooms[d.code];
    if (!r) return cb({ ok: false, e: 'No room' });
    var p = findP(r, socket.id);
    if (!p || p.id !== r.hid) return cb({ ok: false, e: 'No auth' });
    if (r.gt === 'th') {
      r.bets = {}; r.cb = 0;
      for (var i = 0; i < r.players.length; i++) if (!r.players[i].fold) r.players[i].act = '';
      if (r.ph === 'preflop') {
        r.ph = 'flop';
        if (r.cm === 'v') { r.deck.pop(); r.cc.push(r.deck.pop(), r.deck.pop(), r.deck.pop()); }
      } else if (r.ph === 'flop') {
        r.ph = 'turn';
        if (r.cm === 'v') { r.deck.pop(); r.cc.push(r.deck.pop()); }
      } else if (r.ph === 'turn') {
        r.ph = 'river';
        if (r.cm === 'v') { r.deck.pop(); r.cc.push(r.deck.pop()); }
      }
    } else if (r.gt === 'bj') {
      if (r.ph === 'bet') {
        r.ph = 'play';
        for (var i = 0; i < r.players.length; i++) {
          if (r.players[i].bjBet === 0) r.players[i].fold = true;
          r.players[i].act = '';
        }
      } else if (r.ph === 'play') {
        r.ph = 'res';
        for (var i = 0; i < r.players.length; i++) r.players[i].act = '';
      }
    } else if (r.gt === 'dr') {
      r.bets = {}; r.cb = 0;
      for (var i = 0; i < r.players.length; i++) if (!r.players[i].fold) r.players[i].act = '';
      if (r.ph === 'bet1') r.ph = 'swap';
      else if (r.ph === 'swap') r.ph = 'bet2';
      else if (r.ph === 'bet2') r.ph = 'show';
    }
    sendState(d.code); cb({ ok: true });
  });

  socket.on('close', function(d, cb) {
    var r = rooms[d.code];
    if (!r) return cb({ ok: false, e: 'No room' });
    var p = findP(r, socket.id);
    if (!p || p.id !== r.hid) return cb({ ok: false, e: 'No auth' });
    var res = d.res;
    if (r.gt === 'bj') {
      if (!res || !Array.isArray(res)) return cb({ ok: false, e: 'No results' });
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
      r.hist.unshift({ h: r.hn, w: wn.length > 0 ? wn.join(', ') : 'Banco', p: r.pot, t: new Date().toLocaleTimeString('it') });
    } else {
      if (!res || !Array.isArray(res) || res.length === 0) return cb({ ok: false, e: 'Pick winner' });
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
      r.hist.unshift({ h: r.hn, w: wn.join(', '), p: r.pot, t: new Date().toLocaleTimeString('it') });
    }
    r.pot = 0;
    newHand(r); sendState(d.code); cb({ ok: true });
  });

  socket.on('end', function(d, cb) {
    var r = rooms[d.code];
    if (!r) return cb({ ok: false, e: 'No room' });
    var p = findP(r, socket.id);
    if (!p || p.id !== r.hid) return cb({ ok: false, e: 'No auth' });
    var st = [];
    for (var i = 0; i < r.players.length; i++) {
      var pl = r.players[i];
      st.push({ nick: pl.nick, chips: pl.chips, diff: pl.chips - r.ic, color: pl.color });
    }
    st.sort(function(a, b) { return b.chips - a.chips; });
    io.to(d.code).emit('over', { st: st });
    delete rooms[d.code];
    cb({ ok: true });
  });

  socket.on('disconnect', function() {
    if (!socket.data) return;
    var r = rooms[socket.data.code];
    if (!r) return;
    for (var i = 0; i < r.players.length; i++) {
      if (r.players[i].nick === socket.data.nick) {
        r.players[i].on = false;
        if (r.players[i].id === r.hid) io.to(r.code).emit('hp');
        break;
      }
    }
    sendState(socket.data.code);
  });
});

server.listen(PORT, '0.0.0.0', function() {
  console.log('OK port ' + PORT);
});
