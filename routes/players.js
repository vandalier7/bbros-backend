const express = require('express');
const playerStore = require('../playerStore');

const router = express.Router();

// POST /players
// body: { username: string }
// Issues a fresh player row for this session. Usernames are unique now, so
// this can fail with 409 if already taken — the client should let the
// player pick a different name and retry.
router.post('/', async (req, res) => {
  const username = (req.body.username || '').trim();

  if (!username) {
    return res.status(400).json({ error: 'username is required' });
  }
  if (username.length > 24) {
    return res.status(400).json({ error: 'username too long (max 24 chars)' });
  }

  try {
    const player = await playerStore.createPlayer(username);
    res.json({ playerId: player.id, username: player.username });
  } catch (err) {
    if (err.isConflict) {
      return res.status(409).json({ error: 'username already taken' });
    }
    console.error('[players] createPlayer failed:', err.message);
    res.status(500).json({ error: 'failed to create player' });
  }
});

module.exports = router;