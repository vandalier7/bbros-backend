const express = require('express');
const playerStore = require('../playerStore');
const inviteStore = require('../inviteStore');
const lobbyStore = require('../lobbyStore');

const router = express.Router();

// POST /invites/send
// body: { fromPlayerId: string, toPlayerId: string }
// Sends a game invite. Unlike friend requests, this is looked up by
// playerId rather than username — by the time two players can invite each
// other they're already friends, so the client already has their ID from
// the friends list (no need to re-resolve by name).
router.post('/send', async (req, res) => {
  const { fromPlayerId, toPlayerId } = req.body;

  if (!fromPlayerId || !toPlayerId) {
    return res.status(400).json({ error: 'fromPlayerId and toPlayerId are required' });
  }

  try {
    const fromPlayer = await playerStore.getPlayer(fromPlayerId);
    if (!fromPlayer) {
      return res.status(404).json({ error: 'fromPlayerId does not exist' });
    }

    const toPlayer = await playerStore.getPlayer(toPlayerId);
    if (!toPlayer) {
      return res.status(404).json({ error: 'toPlayerId does not exist' });
    }

    // Invites only make sense if the recipient is actually reachable right
    // now — unlike a friend request, there's no point queuing this for
    // later, since it's tied to "come join my match" in the moment.
    const toSocket = playerStore.getSocket(toPlayer.id);
    if (!toSocket) {
      return res.status(409).json({ error: 'target player is not online' });
    }

    const invite = await inviteStore.sendInvite(fromPlayer.id, toPlayer.id);
    res.json({ invite });

    toSocket.send(JSON.stringify({
      type: 'invite',
      invite,
      fromUsername: fromPlayer.username,
    }));
  } catch (err) {
    if (err.isBadRequest) {
      return res.status(400).json({ error: err.message });
    }
    if (err.isConflict) {
      return res.status(409).json({ error: err.message });
    }
    console.error('[invites] sendInvite failed:', err.message);
    res.status(500).json({ error: 'failed to send invite' });
  }
});

// POST /invites/accept
// body: { inviteId: string, playerId: string }
// playerId must be the RECIPIENT, not the sender.
// Accepting also creates a lobby right away — this is the session both
// clients report their ENet port to next (see routes/lobbies.js), so it's
// returned in this same response and pushed to the sender over WebSocket.
router.post('/accept', async (req, res) => {
  const { inviteId, playerId } = req.body;

  if (!inviteId || !playerId) {
    return res.status(400).json({ error: 'inviteId and playerId are required' });
  }

  try {
    const invite = await inviteStore.acceptInvite(inviteId, playerId);
    if (!invite) {
      return res.status(404).json({ error: 'no matching pending invite to accept' });
    }

    const lobby = await lobbyStore.createLobby(
      invite.id,
      invite.from_player_id,
      invite.to_player_id
    );

    res.json({ invite, lobby });

    // Notify the original sender if they're still online, so their client
    // can move into "waiting for lobby" state too.
    const senderSocket = playerStore.getSocket(invite.from_player_id);
    if (senderSocket) {
      senderSocket.send(JSON.stringify({ type: 'inviteAccepted', invite, lobby }));
    }
  } catch (err) {
    console.error('[invites] acceptInvite failed:', err.message);
    res.status(500).json({ error: 'failed to accept invite' });
  }
});

// POST /invites/decline
// body: { inviteId: string, playerId: string }
// playerId must be the RECIPIENT, not the sender.
router.post('/decline', async (req, res) => {
  const { inviteId, playerId } = req.body;

  if (!inviteId || !playerId) {
    return res.status(400).json({ error: 'inviteId and playerId are required' });
  }

  try {
    const invite = await inviteStore.declineInvite(inviteId, playerId);
    if (!invite) {
      return res.status(404).json({ error: 'no matching pending invite to decline' });
    }
    res.json({ invite });

    const senderSocket = playerStore.getSocket(invite.from_player_id);
    if (senderSocket) {
      senderSocket.send(JSON.stringify({ type: 'inviteDeclined', invite }));
    }
  } catch (err) {
    console.error('[invites] declineInvite failed:', err.message);
    res.status(500).json({ error: 'failed to decline invite' });
  }
});

// GET /invites/:playerId
// Returns this player's pending invites split into incoming (someone
// invited them) and outgoing (they invited someone else).
router.get('/:playerId', async (req, res) => {
  const { playerId } = req.params;

  try {
    const player = await playerStore.getPlayer(playerId);
    if (!player) {
      return res.status(404).json({ error: 'playerId does not exist' });
    }

    const { incomingInvites, outgoingInvites } = await inviteStore.listForPlayer(playerId);

    const resolveUsernames = async (entries) => {
      const resolved = [];
      for (const entry of entries) {
        const otherPlayer = await playerStore.getPlayer(entry.playerId);
        resolved.push({
          ...entry,
          username: otherPlayer ? otherPlayer.username : null,
          online: playerStore.isOnline(entry.playerId),
        });
      }
      return resolved;
    };

    res.json({
      incomingInvites: await resolveUsernames(incomingInvites),
      outgoingInvites: await resolveUsernames(outgoingInvites),
    });
  } catch (err) {
    console.error('[invites] listForPlayer failed:', err.message);
    res.status(500).json({ error: 'failed to list invites' });
  }
});

module.exports = router;