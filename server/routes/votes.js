'use strict';

const express = require('express');
const db = require('../db');
const { aggregateVotes } = require('../cafeModel');
const { requireAuth } = require('../auth');

const router = express.Router();

const cafeExists = db.prepare('SELECT 1 FROM cafes WHERE id = ?');
const upsertVote = db.prepare(`
  INSERT INTO votes (cafe_id, user_id, category, score, updated_at)
  VALUES (@cafe_id, @user_id, @category, @score, datetime('now'))
  ON CONFLICT(cafe_id, user_id, category)
  DO UPDATE SET score = excluded.score, updated_at = datetime('now')
`);

const CATS = new Set(['coffee', 'quiet', 'restroom']);

// POST /api/cafes/:id/vote  { category, score }
router.post('/:id/vote', requireAuth, express.json(), (req, res) => {
  const { id } = req.params;
  const { category, score } = req.body || {};
  if (!cafeExists.get(id)) return res.status(404).json({ error: 'not found' });
  if (!CATS.has(category)) return res.status(400).json({ error: 'invalid category' });
  const s = Number(score);
  if (!Number.isInteger(s) || s < 1 || s > 5) return res.status(400).json({ error: 'score must be 1-5' });

  upsertVote.run({ cafe_id: id, user_id: req.user.id, category, score: s });
  res.json(aggregateVotes(id));
});

module.exports = router;
