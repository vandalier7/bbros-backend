const db = require('./db');

const LOBBY_COLUMNS = `id, invite_id, player_id_a, player_id_b,
  player_a_ip, player_a_port, player_b_ip, player_b_port, status, created_at`;

async function createLobby(inviteId, fromPlayerId, toPlayerId) {
  const result = await db.query(
    `INSERT INTO lobbies (invite_id, player_id_a, player_id_b, status)
     VALUES ($1, $2, $3, 'waiting_for_ports')
     RETURNING ${LOBBY_COLUMNS}`,
    [inviteId, fromPlayerId, toPlayerId]
  );
  return result.rows[0];
}

async function getLobby(lobbyId) {
  const result = await db.query(
    `SELECT ${LOBBY_COLUMNS} FROM lobbies WHERE id = $1`,
    [lobbyId]
  );
  return result.rows[0] || null;
}

// Records a player's ENet endpoint (their game-traffic IP/port — distinct
// from whatever port their HTTP/WS connection to this backend used). Once
// BOTH players in the lobby have reported an endpoint, status flips to
// 'ready' so the caller knows to push the handoff over WebSocket.
async function reportEndpoint(lobbyId, playerId, ip, port) {
  const lobby = await getLobby(lobbyId);
  if (!lobby) return null;

  let side;
  if (lobby.player_id_a === playerId) {
    side = 'a';
  } else if (lobby.player_id_b === playerId) {
    side = 'b';
  } else {
    const err = new Error('playerId is not part of this lobby');
    err.isBadRequest = true;
    throw err;
  }

  // `side` is only ever 'a' or 'b', set by us above — never taken directly
  // from request input — so interpolating it into the column name here is
  // safe from injection.
  const result = await db.query(
    `UPDATE lobbies SET player_${side}_ip = $1, player_${side}_port = $2
     WHERE id = $3
     RETURNING ${LOBBY_COLUMNS}`,
    [ip, port, lobbyId]
  );
  let updated = result.rows[0];

  const bothReported =
    updated.player_a_ip && updated.player_a_port &&
    updated.player_b_ip && updated.player_b_port;

  if (bothReported && updated.status !== 'ready') {
    const readyResult = await db.query(
      `UPDATE lobbies SET status = 'ready' WHERE id = $1
       RETURNING ${LOBBY_COLUMNS}`,
      [lobbyId]
    );
    updated = readyResult.rows[0];
  }

  return updated;
}

module.exports = {
  createLobby,
  getLobby,
  reportEndpoint,
};