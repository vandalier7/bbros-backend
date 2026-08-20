const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const playerStore = require('./playerStore');
const playersRoute = require('./routes/players');
const friendsRoute = require('./routes/friends');
const invitesRoute = require('./routes/invites');
const lobbiesRoute = require('./routes/lobbies');

// Step 1: the Express app. This is just routing/middleware — it doesn't
// listen on anything by itself.
const app = express();
app.use(express.json());

app.set('trust proxy', 'loopback');

// Test route — proves REST wiring works before we build real lobby logic.
app.get('/ping', (req, res) => {
  res.json({ ok: true, message: 'pong' });
});

// Identity route: POST /players { username } -> { playerId, username }
app.use('/players', playersRoute);

// Friendship routes: POST /friends/request, POST /friends/accept
app.use('/friends', friendsRoute);

// Invite routes: POST /invites/send, POST /invites/accept, POST /invites/decline
app.use('/invites', invitesRoute);

// Lobby routes: GET /lobbies/:lobbyId, POST /lobbies/:lobbyId/endpoint
app.use('/lobbies', lobbiesRoute);

// Step 2: create the raw HTTP server ourselves, handing it the Express app
// as its request handler. This is the object that actually binds to a port.
const server = http.createServer(app);

// Step 3: attach the WebSocket server to that SAME raw server, not a new
// port. ws listens for the HTTP "upgrade" event — the handshake a client
// sends when it wants to switch a connection from HTTP to WebSocket.
const wss = new WebSocketServer({ server });

// Presence: a client must identify itself right after connecting by sending
// a JSON message like { type: 'identify', playerId: '...' }. Until it does,
// the socket is connected but not yet associated with any player — nothing
// (like a game invite) can be pushed to it yet.
wss.on('connection', (ws) => {
  console.log('[ws] client connected (not yet identified)');
  ws.playerId = null;

  ws.on('message', async (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch (err) {
      console.log('[ws] received non-JSON message, ignoring:', data.toString());
      return;
    }

    if (message.type === 'identify') {
      let player;
      try {
        player = await playerStore.getPlayer(message.playerId);
      } catch (err) {
        console.error('[ws] getPlayer failed:', err.message);
        ws.send(JSON.stringify({ type: 'error', message: 'lookup failed' }));
        return;
      }
      if (!player) {
        ws.send(JSON.stringify({ type: 'error', message: 'unknown playerId' }));
        return;
      }
      ws.playerId = player.id;
      playerStore.setOnline(player.id, ws);
      console.log(`[ws] identified as ${player.username} (${player.id})`);
      ws.send(JSON.stringify({ type: 'identified', playerId: player.id }));
      return;
    }

    console.log('[ws] received:', message);
  });

  ws.on('close', () => {
    if (ws.playerId) {
      console.log(`[ws] player disconnected: ${ws.playerId}`);
      playerStore.setOffline(ws.playerId);
    } else {
      console.log('[ws] client disconnected (was never identified)');
    }
  });
});

// Step 6: start listening. Note this is called on `server`, NOT on `app`.
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT} (HTTP + WS)`);
});