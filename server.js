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
  var su = ['s','h','d','c'];
  var va = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  var d = [];
  for (var i = 0; i < 4; i++) for (var j = 0; j < 13; j++) d.push({s:su[i],v:va[j]});
  for (var i = d.length-1; i > 0; i--) { var j = Math.floor(Math.random()*(i+1)); var t=d[i]; d[i]=d[j]; d[j]=t; }
  return d;
}

function bjVal(cards) {
  var t=0, a=0;
  for (var i=0; i<cards.length; i++) {
    var v=cards[i].v;
    if (v==='A'){t+=11;a++} else if(v==='K'||v==='Q'||v==='J'){t+=10} else {t+=parseInt(v)}
  }
  while(t>21&&a>0){t-=10;a--}
  return t;
}

function fp(r,sid) {
  for(var i=0;i<r.players.length;i++) if(r.players[i].sid===sid) return r.players[i];
  return null;
}

function newHand(r) {
  r.hn++; r.pot=0; r.curB=0; r.rB={}; r.cc=[]; r.dv=null; r.dc=[]; r.deck=mkDeck();
  for(var i=0;i<r.players.length;i++){
    var p=r.players[i]; p.fold=false; p.stood=false; p.bust=false; p.bj21=false;
    p.done=false; p.act=''; p.bet=0; p.cards=[];
  }
  if(r.gt==='texas'){
    r.ph='preflop';
    if(r.cm==='virtual') for(var i=0;i<r.players.length;i++) if(r.players[i].chips>0) r.players[i].cards=[r.deck.pop(),r.deck.pop()];
  } else if(r.gt==='blackjack'){
    r.ph='betting';
    if(r.cm==='virtual'){r.dc=[r.deck.pop(),r.deck.pop()]; r.dv=r.dc[0]}
  } else if(r.gt==='draw'){
    r.ph='bet1';
    if(r.cm==='virtual') for(var i=0;i<r.players.length;i++) if(r.players[i].chips>0){r.players[i].cards=[]; for(var j=0;j<5;j++) r.players[i].cards.push(r.deck.pop())}
  }
}

function sendAll(code) {
  var r=rooms[code]; if(!r) return;
  var pl=[];
  for(var i=0;i<r.players.length;i++){
    var p=r.players[i];
    pl.push({id:p.id,nick:p.nick,chips:p.chips,color:p.color,on:p.on,act:p.act,fold:p.fold,stood:p.stood,bust:p.bust,bj21:p.bj21,done:p.done,bet:p.bet,nc:p.cards?p.cards.length:0,bjt:(r.gt==='blackjack'&&p.cards)?bjVal(p.cards):0});
  }
  var base={code:r.code,gt:r.gt,cm:r.cm,ic:r.ic,sb:r.sb,bb:r.bb,mn:r.mn,mx:r.mx,ms:r.ms,on:r.on,pot:r.pot,hn:r.hn,ph:r.ph,cc:r.cc,dv:r.dv,hist:r.hist,players:pl};
  for(var i=0;i<r.players.length;i++){
    var p=r.players[i]; if(!p.sid) continue;
    var sk=io.sockets.sockets.get(p.sid); if(!sk) continue;
    sk.emit('gameState',{code:base.code,gt:base.gt,cm:base.cm,ic:base.ic,sb:base.sb,bb:base.bb,mn:base.mn,mx:base.mx,ms:base.ms,on:base.on,pot:base.pot,hn:base.hn,ph:base.ph,cc:base.cc,dv:base.dv,hist:base.hist,players:base.players,me:p.id,myC:p.cards||[],host:p.id===r.hid});
  }
}

io.on('connection', function(socket) {
  console.log('connect '+socket.id);

  socket.on('createRoom', function(cb) {
    var code=genCode();
    rooms[code]={code:code,hid:null,players:[],gt:'texas',cm:'physical',ic:1000000,sb:5000,bb:10000,mn:1000,mx:100000,ms:4,on:false,pot:0,hn:0,ph:'wait',deck:[],cc:[],dv:null,dc:[],curB:0,rB:{},hist:[]};
    console.log('room '+code);
    cb({ok:true,code:code});
  });

  socket.on('joinRoom', function(d, cb) {
    var r=rooms[d.code];
    if(!r) return cb({ok:false,err:'Stanza non trovata'});
    var nick=(d.nick||'').trim();
    if(nick.length<2||nick.length>12) return cb({ok:false,err:'Nick 2-12 caratteri'});
    var ex=null;
    for(var i=0;i<r.players.length;i++) if(r.players[i].nick===nick){ex=r.players[i];break}
    if(ex){
      if(ex.on&&ex.sid!==socket.id){var s2=io.sockets.sockets.get(ex.sid); if(s2) return cb({ok:false,err:'Nick in uso'})}
      ex.sid=socket.id; ex.on=true; socket.join(d.code); socket.data={code:d.code,nick:nick}; sendAll(d.code); return cb({ok:true});
    }
    if(r.players.length>=10) return cb({ok:false,err:'Max 10'});
    var pid=Math.random().toString(36).substr(2,8);
    var pl={id:pid,sid:socket.id,nick:nick,chips:0,color:COLORS[r.players.length%10],on:true,act:'',fold:false,stood:false,bust:false,bj21:false,done:false,bet:0,cards:[]};
    if(r.players.length===0) r.hid=pid;
    r.players.push(pl); socket.join(d.code); socket.data={code:d.code,nick:nick}; sendAll(d.code); cb({ok:true});
  });

  socket.on('configure', function(d) {
    var r=rooms[d.code]; if(!r||r.on) return;
    var p=fp(r,socket.id); if(!p||p.id!==r.hid) return;
    if(d.gt) r.gt=d.gt; if(d.cm) r.cm=d.cm; if(d.ic) r.ic=d.ic;
    if(d.sb!==undefined) r.sb=d.sb; if(d.bb!==undefined) r.bb=d.bb;
    if(d.mn!==undefined) r.mn=d.mn; if(d.mx!==undefined) r.mx=d.mx;
    if(d.ms!==undefined) r.ms=d.ms;
    sendAll(d.code);
  });

  socket.on('startGame', function(d,cb) {
    var r=rooms[d.code]; if(!r) return cb({ok:false,err:'No room'});
    var p=fp(r,socket.id); if(!p||p.id!==r.hid) return cb({ok:false,err:'No auth'});
    if(r.players.length<2) return cb({ok:false,err:'Min 2'});
    r.on=true;
    for(var i=0;i<r.players.length;i++) r.players[i].chips=r.ic;
    newHand(r); sendAll(d.code); cb({ok:true});
  });

  socket.on('playerAction', function(d,cb) {
    var r=rooms[d.code]; if(!r||!r.on) return cb({ok:false,err:'No game'});
    var p=fp(r,socket.id); if(!p) return cb({ok:false,err:'No player'});
    var amt=parseInt(d.amt)||0;
    var act=d.act;
    if(r.gt==='texas'||r.gt==='draw'){
      if(p.fold||p.chips<=0) return cb({ok:false,err:'Non puoi'});
      var mb=r.rB[p.id]||0; var tc=r.curB-mb;
      if(act==='fold'){p.fold=true;p.act='Fold'}
      else if(act==='check'){if(tc>0) return cb({ok:false,err:'Devi Call'}); p.act='Check'}
      else if(act==='call'){var ca=Math.min(tc,p.chips); p.chips-=ca; r.pot+=ca; r.rB[p.id]=mb+ca; p.act='Call '+ca}
      else if(act==='bet'){if(amt<=0||amt>p.chips) return cb({ok:false,err:'Importo errato'}); p.chips-=amt; r.pot+=amt; r.curB=mb+amt; r.rB[p.id]=r.curB; p.act='Bet '+amt}
      else if(act==='raise'){if(amt<=0) return cb({ok:false,err:'Importo errato'}); var tot=tc+amt; if(tot>p.chips) return cb({ok:false,err:'Insufficienti'}); p.chips-=tot; r.pot+=tot; r.rB[p.id]=mb+tot; r.curB=r.rB[p.id]; p.act='Raise '+amt}
      else if(act==='allin'){var aa=p.chips; r.pot+=aa; r.rB[p.id]=(r.rB[p.id]||0)+aa; if(r.rB[p.id]>r.curB) r.curB=r.rB[p.id]; p.chips=0; p.act='All-in '+aa}
      else return cb({ok:false,err:'Azione invalida'});
    } else if(r.gt==='blackjack'){
      if(r.ph==='betting'){
        if(act==='bjbet'){
          if(amt<r.mn||amt>r.mx) return cb({ok:false,err:'Bet '+r.mn+'-'+r.mx});
          if(amt>p.chips) return cb({ok:false,err:'Insufficienti'});
          p.chips-=amt; p.bet=amt; r.pot+=amt; p.act='Bet '+amt;
          if(r.cm==='virtual'&&p.cards.length===0){p.cards=[r.deck.pop(),r.deck.pop()]; if(bjVal(p.cards)===21) p.bj21=true}
        }
      } else if(r.ph==='playing'){
        if(p.stood||p.bust||p.bet===0) return cb({ok:false,err:'Non puoi'});
        if(act==='hit'){
          if(r.cm==='virtual'){p.cards.push(r.deck.pop()); var sc=bjVal(p.cards); if(sc>21){p.bust=true;p.act='Bust!'} else if(sc===21){p.stood=true;p.act='21!'} else p.act='Hit'} else p.act='Hit';
        } else if(act==='stand'){p.stood=true;p.act='Stand'}
        else if(act==='double'){
          if(p.bet>p.chips) return cb({ok:false,err:'Insufficienti'});
          p.chips-=p.bet; r.pot+=p.bet; p.bet*=2;
          if(r.cm==='virtual'){p.cards.push(r.deck.pop()); if(bjVal(p.cards)>21){p.bust=true;p.act='Dbl Bust!'} else p.act='Double'} else p.act='Double';
          p.stood=true;
        } else if(act==='surrender'){
          var half=Math.floor(p.bet/2); p.chips+=half; r.pot-=half; p.stood=true; p.fold=true; p.act='Surrender';
        }
      }
    }
    sendAll(d.code); cb({ok:true});
  });

  socket.on('swapCards', function(d,cb) {
    var r=rooms[d.code]; if(!r||r.gt!=='draw'||r.ph!=='swap') return cb({ok:false,err:'Non ora'});
    var p=fp(r,socket.id); if(!p||p.fold||p.done) return cb({ok:false,err:'Non puoi'});
    var idx=d.idx; if(!Array.isArray(idx)) return cb({ok:false,err:'Errore'});
    if(idx.length>r.ms) return cb({ok:false,err:'Max '+r.ms});
    if(r.cm==='virtual') for(var i=0;i<idx.length;i++) if(idx[i]>=0&&idx[i]<p.cards.length) p.cards[idx[i]]=r.deck.pop();
    p.done=true; p.act=idx.length===0?'Mantiene':'Scambia '+idx.length;
    sendAll(d.code); cb({ok:true});
  });

  socket.on('advancePhase', function(d,cb) {
    var r=rooms[d.code]; if(!r) return cb({ok:false,err:'No room'});
    var p=fp(r,socket.id); if(!p||p.id!==r.hid) return cb({ok:false,err:'No auth'});
    if(r.gt==='texas'){
      r.rB={}; r.curB=0;
      for(var i=0;i<r.players.length;i++) if(!r.players[i].fold) r.players[i].act='';
      if(r.ph==='preflop'){r.ph='flop'; if(r.cm==='virtual'){r.deck.pop(); r.cc.push(r.deck.pop(),r.deck.pop(),r.deck.pop())}}
      else if(r.ph==='flop'){r.ph='turn'; if(r.cm==='virtual'){r.deck.pop(); r.cc.push(r.deck.pop())}}
      else if(r.ph==='turn'){r.ph='river'; if(r.cm==='virtual'){r.deck.pop(); r.cc.push(r.deck.pop())}}
    } else if(r.gt==='blackjack'){
      if(r.ph==='betting'){r.ph='playing'; for(var i=0;i<r.players.length;i++){if(r.players[i].bet===0) r.players[i].fold=true; r.players[i].act=''}}
      else if(r.ph==='playing'){r.ph='results'; for(var i=0;i<r.players.length;i++) r.players[i].act=''}
    } else if(r.gt==='draw'){
      r.rB={}; r.curB=0;
      for(var i=0;i<r.players.length;i++) if(!r.players[i].fold) r.players[i].act='';
      if(r.ph==='bet1') r.ph='swap'; else if(r.ph==='swap') r.ph='bet2'; else if(r.ph==='bet2') r.ph='show';
    }
    sendAll(d.code); cb({ok:true});
  });

  socket.on('closeHand', function(d,cb) {
    var r=rooms[d.code]; if(!r) return cb({ok:false,err:'No room'});
    var p=fp(r,socket.id); if(!p||p.id!==r.hid) return cb({ok:false,err:'No auth'});
    var res=d.res;
    if(r.gt==='blackjack'){
      if(!res||!Array.isArray(res)) return cb({ok:false,err:'Dati mancanti'});
      var wn=[];
      for(var i=0;i<res.length;i++){
        var pl=null; for(var j=0;j<r.players.length;j++) if(r.players[j].id===res[i].id){pl=r.players[j];break}
        if(!pl) continue;
        if(res[i].r==='w'){pl.chips+=pl.bet*2;wn.push(pl.nick)}
        else if(res[i].r==='bj'){pl.chips+=Math.floor(pl.bet*2.5);wn.push(pl.nick)}
        else if(res[i].r==='p'){pl.chips+=pl.bet}
      }
      r.hist.unshift({h:r.hn,w:wn.length?wn.join(', '):'Banco',p:r.pot,t:new Date().toLocaleTimeString('it')});
    } else {
      if(!res||!Array.isArray(res)||!res.length) return cb({ok:false,err:'Scegli vincitore'});
      var share=Math.floor(r.pot/res.length); var rem=r.pot%res.length; var wn=[];
      for(var i=0;i<res.length;i++) for(var j=0;j<r.players.length;j++) if(r.players[j].id===res[i]){r.players[j].chips+=share+(i===0?rem:0);wn.push(r.players[j].nick)}
      r.hist.unshift({h:r.hn,w:wn.join(', '),p:r.pot,t:new Date().toLocaleTimeString('it')});
    }
    r.pot=0; newHand(r); sendAll(d.code); cb({ok:true});
  });

  socket.on('endSession', function(d,cb) {
    var r=rooms[d.code]; if(!r) return cb({ok:false,err:'No room'});
    var p=fp(r,socket.id); if(!p||p.id!==r.hid) return cb({ok:false,err:'No auth'});
    var st=[];
    for(var i=0;i<r.players.length;i++){var pl=r.players[i]; st.push({nick:pl.nick,chips:pl.chips,diff:pl.chips-r.ic,color:pl.color})}
    st.sort(function(a,b){return b.chips-a.chips});
    io.to(d.code).emit('sessionEnded',{st:st});
    delete rooms[d.code]; cb({ok:true});
  });

  socket.on('disconnect', function() {
    if(!socket.data) return;
    var r=rooms[socket.data.code]; if(!r) return;
    for(var i=0;i<r.players.length;i++){
      if(r.players[i].nick===socket.data.nick){
        r.players[i].on=false;
        if(r.players[i].id===r.hid) io.to(r.code).emit('hostPaused');
        break;
      }
    }
    sendAll(socket.data.code);
  });
});

http.listen(PORT, function(){console.log('OK '+PORT)});
