const express = require('express');
const playerStore = require('../playerStore');
const friendshipStore = require('../friendshipStore');

const router = express.Router();

// POST /friends/request
// body: { fromPlayerId: string, toUsername: string }
// Sends a friend request by username (now safe to look up by name since
// usernames are unique).
router.post('/request', async (req, res) => {
  const { fromPlayerId, toUsername } = req.body;

  if (!fromPlayerId || !toUsername) {
    return res.status(400).json({ error: 'fromPlayerId and toUsername are required' });
  }

  try {
    const fromPlayer = await playerStore.getPlayer(fromPlayerId);
    if (!fromPlayer) {
      return res.status(404).json({ error: 'fromPlayerId does not exist' });
    }

    const toPlayer = await playerStore.getPlayerByUsername(toUsername.trim());
    if (!toPlayer) {
      return res.status(404).json({ error: 'no player with that username' });
    }

    const friendship = await friendshipStore.sendRequest(fromPlayer.id, toPlayer.id);
    res.json({ friendship });

    // If the invited player is currently online, push them a live
    // notification so their friends list/UI can update immediately instead
    // of waiting for them to poll GET /friends.
    const toSocket = playerStore.getSocket(toPlayer.id);
    if (toSocket) {
      toSocket.send(JSON.stringify({
        type: 'friendRequest',
        friendship,
        fromUsername: fromPlayer.username,
      }));
    }
  } catch (err) {
    if (err.isBadRequest) {
      return res.status(400).json({ error: err.message });
    }
    if (err.isConflict) {
      return res.status(409).json({ error: err.message });
    }
    console.error('[friends] sendRequest failed:', err.message);
    res.status(500).json({ error: 'failed to send friend request' });
  }
});

// POST /friends/accept
// body: { friendshipId: string, playerId: string }
// playerId must be the INVITED player, not the requester.
router.post('/accept', async (req, res) => {
  const { friendshipId, playerId } = req.body;

  if (!friendshipId || !playerId) {
    return res.status(400).json({ error: 'friendshipId and playerId are required' });
  }

  try {
    const friendship = await friendshipStore.acceptRequest(friendshipId, playerId);
    if (!friendship) {
      return res.status(404).json({ error: 'no matching pending request to accept' });
    }
    res.json({ friendship });

    // Notify the original requester if they're online.
    const otherPlayerId = friendship.player_id_a === playerId
      ? friendship.player_id_b
      : friendship.player_id_a;
    const otherSocket = playerStore.getSocket(otherPlayerId);
    if (otherSocket) {
      otherSocket.send(JSON.stringify({ type: 'friendRequestAccepted', friendship }));
    }
  } catch (err) {
    console.error('[friends] acceptRequest failed:', err.message);
    res.status(500).json({ error: 'failed to accept friend request' });
  }
});

// GET /friends/:playerId
// Returns this player's accepted friends, requests they've received
// (incoming), and requests they've sent that are still pending (outgoing).
// Each entry includes the OTHER player's username, resolved for display —
// a friends list showing raw UUIDs isn't useful to a client.
router.get('/:playerId', async (req, res) => {
  const { playerId } = req.params;

  try {
    const player = await playerStore.getPlayer(playerId);
    if (!player) {
      return res.status(404).json({ error: 'playerId does not exist' });
    }

    const { friends, incomingRequests, outgoingRequests } =
      await friendshipStore.listForPlayer(playerId);

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
      friends: await resolveUsernames(friends),
      incomingRequests: await resolveUsernames(incomingRequests),
      outgoingRequests: await resolveUsernames(outgoingRequests),
    });
  } catch (err) {
    console.error('[friends] listForPlayer failed:', err.message);
    res.status(500).json({ error: 'failed to list friends' });
  }
});

module.exports = router;