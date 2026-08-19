const db = require('./db');

// Invites are directional (unlike friendships) — from_player_id is always
// the sender, to_player_id is always the recipient, so there's no ordered-
// pair trick needed here like in friendshipStore. But we DO require an
// accepted friendship to exist between the two players before an invite
// can be sent, since invites are meant to be the "hey, join my match" ping
// between people who are already friends.

function orderPair(idOne, idTwo) {
  return idOne < idTwo ? [idOne, idTwo] : [idTwo, idOne];
}

async function areFriends(idOne, idTwo) {
  const [playerIdA, playerIdB] = orderPair(idOne, idTwo);
  const result = await db.query(
    `SELECT 1 FROM friendships
     WHERE player_id_a = $1 AND player_id_b = $2 AND status = 'accepted'`,
    [playerIdA, playerIdB]
  );
  return result.rows.length > 0;
}

async function sendInvite(fromPlayerId, toPlayerId) {
  if (fromPlayerId === toPlayerId) {
    const err = new Error('cannot invite yourself');
    err.isBadRequest = true;
    throw err;
  }

  const friends = await areFriends(fromPlayerId, toPlayerId);
  if (!friends) {
    const err = new Error('players must be friends before an invite can be sent');
    err.isBadRequest = true;
    throw err;
  }

  // Explicit existence check rather than relying on a DB constraint, since
  // (unlike friendships) invites aren't stored as one row per pair — the
  // same two players could plausibly have an old declined/expired invite
  // on record, and only an outstanding PENDING one should block a new one.
  const existing = await db.query(
    `SELECT 1 FROM invites
     WHERE ((from_player_id = $1 AND to_player_id = $2)
         OR (from_player_id = $2 AND to_player_id = $1))
       AND status = 'pending'`,
    [fromPlayerId, toPlayerId]
  );
  if (existing.rows.length > 0) {
    const err = new Error('a pending invite already exists between these players');
    err.isConflict = true;
    throw err;
  }

  const result = await db.query(
    `INSERT INTO invites (from_player_id, to_player_id, status)
     VALUES ($1, $2, 'pending')
     RETURNING id, from_player_id, to_player_id, status, created_at`,
    [fromPlayerId, toPlayerId]
  );
  return result.rows[0];
}

async function acceptInvite(inviteId, acceptingPlayerId) {
  // Only the RECIPIENT can accept — mirrors the friendship guard that
  // stops a requester from accepting their own outgoing request.
  const result = await db.query(
    `UPDATE invites
     SET status = 'accepted'
     WHERE id = $1
       AND status = 'pending'
       AND to_player_id = $2
     RETURNING id, from_player_id, to_player_id, status, created_at`,
    [inviteId, acceptingPlayerId]
  );
  return result.rows[0] || null;
}

async function declineInvite(inviteId, decliningPlayerId) {
  const result = await db.query(
    `UPDATE invites
     SET status = 'declined'
     WHERE id = $1
       AND status = 'pending'
       AND to_player_id = $2
     RETURNING id, from_player_id, to_player_id, status, created_at`,
    [inviteId, decliningPlayerId]
  );
  return result.rows[0] || null;
}

async function listForPlayer(playerId) {
  const result = await db.query(
    `SELECT id, from_player_id, to_player_id, status, created_at
     FROM invites
     WHERE (from_player_id = $1 OR to_player_id = $1)
       AND status = 'pending'
     ORDER BY created_at DESC`,
    [playerId]
  );

  const incomingInvites = [];
  const outgoingInvites = [];

  for (const row of result.rows) {
    const isOutgoing = row.from_player_id === playerId;
    const otherPlayerId = isOutgoing ? row.to_player_id : row.from_player_id;
    const entry = {
      inviteId: row.id,
      playerId: otherPlayerId,
      createdAt: row.created_at,
    };

    if (isOutgoing) {
      outgoingInvites.push(entry);
    } else {
      incomingInvites.push(entry);
    }
  }

  return { incomingInvites, outgoingInvites };
}

module.exports = {
  areFriends,
  sendInvite,
  acceptInvite,
  declineInvite,
  listForPlayer,
};