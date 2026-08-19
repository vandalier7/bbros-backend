const db = require('./db');

// Players persist in Postgres. Presence does NOT — a live WebSocket
// connection object can't be stored in a database, so "who's online right
// now" stays an in-memory Map regardless of what persists player records.
const presence = new Map(); // playerId -> ws connection

async function createPlayer(username) {
  try {
    const result = await db.query(
      'INSERT INTO players (username) VALUES ($1) RETURNING id, username, created_at',
      [username]
    );
    return result.rows[0];
  } catch (err) {
    // Postgres unique_violation code — surface as a clean, checkable error
    // instead of leaking the raw DB error up to the route.
    if (err.code === '23505') {
      const conflictErr = new Error('username already taken');
      conflictErr.isConflict = true;
      throw conflictErr;
    }
    throw err;
  }
}

async function getPlayer(playerId) {
  const result = await db.query(
    'SELECT id, username, created_at FROM players WHERE id = $1',
    [playerId]
  );
  return result.rows[0] || null;
}

async function getPlayerByUsername(username) {
  const result = await db.query(
    'SELECT id, username, created_at FROM players WHERE username = $1',
    [username]
  );
  return result.rows[0] || null;
}

function setOnline(playerId, ws) {
  presence.set(playerId, ws);
}

function setOffline(playerId) {
  presence.delete(playerId);
}

function isOnline(playerId) {
  return presence.has(playerId);
}

function getSocket(playerId) {
  return presence.get(playerId) || null;
}

module.exports = {
  createPlayer,
  getPlayer,
  getPlayerByUsername,
  setOnline,
  setOffline,
  isOnline,
  getSocket,
};