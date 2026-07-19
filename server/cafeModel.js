'use strict';

const db = require('./db');
const { overallScore } = require('./score');

const avgStmt = db.prepare(`
  SELECT category, AVG(score) AS avg, COUNT(*) AS n
  FROM votes WHERE cafe_id = ? GROUP BY category
`);

const CAT_MAP = { coffee: 'coffee', quiet: 'quiet', restroom: 'restroom' };

// Returns { averages:{coffee,quiet,restroom}, counts:{...} }
function aggregateVotes(cafeId) {
  const rows = avgStmt.all(cafeId);
  const averages = { coffee: null, quiet: null, restroom: null };
  const counts = { coffee: 0, quiet: 0, restroom: 0 };
  for (const r of rows) {
    const key = CAT_MAP[r.category];
    if (!key) continue;
    averages[key] = Math.round(r.avg * 10) / 10;
    counts[key] = r.n;
  }
  return { averages, counts };
}

// Decorates a raw cafe row with aggregated votes + overall score, and
// converts integer booleans to real booleans for the client.
function decorate(cafe) {
  const { averages, counts } = aggregateVotes(cafe.id);
  return {
    ...cafe,
    has_view: Number(cafe.has_view) === 1,
    multi_floor: Number(cafe.floors) >= 2,
    status: cafe.status || 'approved',
    votes: { averages, counts },
    score: overallScore(cafe, averages),
  };
}

module.exports = { aggregateVotes, decorate };
