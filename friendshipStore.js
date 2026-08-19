const db = require('./db');

// Friendships are stored as one row per pair, with player_id_a always the
// lexicographically smaller UUID — this guarantees a friendship between A
// and B only ever has ONE row, regardless of who sent the request, so we
// never have to check both (a,b) and (b,a) orderings when looking things up.
function orderPair(idOne, idTwo) {
  return idOne < idTwo ? [idOne, idTwo] : [idTwo, idOne];
}

async function sendRequest(fromPlayerId, toPlayerId) {
  if (fromPlayerId === toPlayerId) {
    const err = new Error('cannot friend yourself');
    err.isBadRequest = true;
    throw err;
  }

  const [playerIdA, playerIdB] = orderPair(fromPlayerId, toPlayerId);

  try {
    const result = await db.query(
      `INSERT INTO friendships (player_id_a, player_id_b, requested_by, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING id, player_id_a, player_id_b, requested_by, status, created_at`,
      [playerIdA, playerIdB, fromPlayerId]
    );
    return result.rows[0];
  } catch (err) {
    if (err.code === '23505') {
      // Already exists (pending or accepted) — treat as a conflict rather
      // than silently creating a duplicate relationship.
      const conflictErr = new Error('friendship already exists or is pending');
      conflictErr.isConflict = true;
      throw conflictErr;
    }
    throw err;
  }
}

async function acceptRequest(friendshipId, acceptingPlayerId) {
  // Only the player who was INVITED (not the requester) should be able to
  // accept — otherwise a player could accept their own outgoing request.
  const result = await db.query(
    `UPDATE friendships
     SET status = 'accepted'
     WHERE id = $1
       AND status = 'pending'
       AND requested_by != $2
       AND (player_id_a = $2 OR player_id_b = $2)
     RETURNING id, player_id_a, player_id_b, requested_by, status, created_at`,
    [friendshipId, acceptingPlayerId]
  );
  return result.rows[0] || null;
}

async function listForPlayer(playerId) {
  const result = await db.query(
    `SELECT id, player_id_a, player_id_b, requested_by, status, created_at
     FROM friendships
     WHERE player_id_a = $1 OR player_id_b = $1
     ORDER BY created_at DESC`,
    [playerId]
  );

  const friends = [];
  const incomingRequests = [];
  const outgoingRequests = [];

  for (const row of result.rows) {
    const otherPlayerId = row.player_id_a === playerId ? row.player_id_b : row.player_id_a;
    const entry = {
      friendshipId: row.id,
      playerId: otherPlayerId,
      createdAt: row.created_at,
    };

    if (row.status === 'accepted') {
      friends.push(entry);
    } else if (row.requested_by === playerId) {
      outgoingRequests.push(entry);
    } else {
      incomingRequests.push(entry);
    }
  }

  return { friends, incomingRequests, outgoingRequests };
}

module.exports = {
  sendRequest,
  acceptRequest,
  listForPlayer,
};