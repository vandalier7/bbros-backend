const express = require('express');
const playerStore = require('../playerStore');
const lobbyStore = require('../lobbyStore');

const router = express.Router();

// GET /lobbies/:lobbyId
router.get('/:lobbyId', async (req, res) => {
  const { lobbyId } = req.params;

  try {
    const lobby = await lobbyStore.getLobby(lobbyId);
    if (!lobby) {
      return res.status(404).json({ error: 'lobby does not exist' });
    }
    res.json({ lobby });
  } catch (err) {
    console.error('[lobbies] getLobby failed:', err.message);
    res.status(500).json({ error: 'failed to fetch lobby' });
  }
});

// POST /lobbies/:lobbyId/endpoint
// body: { playerId: string, port: number }
// Each client calls this once it knows what ENet port it's listening on
// (this is NOT the HTTP/WS port used to talk to this backend). IP is taken
// from the request itself (req.ip), not trusted from the client body — a
// client's own claim about its public IP is unreliable behind NAT anyway.
router.post('/:lobbyId/endpoint', async (req, res) => {
  const { lobbyId } = req.params;
  const { playerId, port } = req.body;

  if (!playerId || !port) {
    return res.status(400).json({ error: 'playerId and port are required' });
  }

  try {
    const player = await playerStore.getPlayer(playerId);
    if (!player) {
      return res.status(404).json({ error: 'playerId does not exist' });
    }

    const ip = req.ip;
    const lobby = await lobbyStore.reportEndpoint(lobbyId, playerId, ip, port);
    if (!lobby) {
      return res.status(404).json({ error: 'lobby does not exist' });
    }

    res.json({ lobby });

    // Once BOTH sides have reported in, push each client the OTHER
    // player's address so they can attempt a direct P2P connection.
    if (lobby.status === 'ready') {
      const socketA = playerStore.getSocket(lobby.player_id_a);
      const socketB = playerStore.getSocket(lobby.player_id_b);

      // player_id_a is always the invite sender (see lobbyStore.createLobby),
      // so it's the fixed, unambiguous host — both clients can trust this
      // flag directly instead of re-deriving host/client from IDs locally.
      if (socketA) {
        socketA.send(JSON.stringify({
          type: 'lobbyReady',
          lobbyId: lobby.id,
          isHost: true,
          peer: { ip: lobby.player_b_ip, port: lobby.player_b_port },
        }));
      }
      if (socketB) {
        socketB.send(JSON.stringify({
          type: 'lobbyReady',
          lobbyId: lobby.id,
          isHost: false,
          peer: { ip: lobby.player_a_ip, port: lobby.player_a_port },
        }));
      }
    }
  } catch (err) {
    if (err.isBadRequest) {
      return res.status(400).json({ error: err.message });
    }
    console.error('[lobbies] reportEndpoint failed:', err.message);
    res.status(500).json({ error: 'failed to report endpoint' });
  }
});

module.exports = router;