// Greedy overlap resolution for photo cards.
//
// As you zoom out, cards start colliding. We keep the highest-scoring card in
// any overlapping cluster and hide the rest - the survivor shows a "+N" badge
// counting how many nearby cards it absorbed.
//
// Cards are anchored bottom-center on their point, so the card's bounding box
// sits ABOVE the point: [x - W/2, y - H, x + W/2, y].

export const CARD_W = 138; // base .cafe-card width (CSS)
export const CARD_H = 128; // full card box: photo + the name label below it (so overlap never buries a name)
// Negative PAD = cards may OVERLAP by this many px before one is culled. Some
// photo overlap is fine for density, but not so much that a name gets covered.
const PAD = -18;

function overlaps(a, b) {
  return !(
    a.right + PAD < b.left ||
    a.left - PAD > b.right ||
    a.bottom + PAD < b.top ||
    a.top - PAD > b.bottom
  );
}

// items: [{ id, score, x, y }]  (x,y = pixel position of the anchor point)
// viewport: { width, height }; cardW/cardH override the card box size (for scaling)
// Returns Map<id, { visible, absorbed }>
export function declutter(items, viewport, cardW = CARD_W, cardH = CARD_H) {
  const sorted = [...items].sort((a, b) => b.score - a.score);
  const placed = []; // { box, id }
  const result = new Map();
  const margin = 80; // allow slightly off-screen so cards don't pop at edges

  for (const it of sorted) {
    const box = {
      left: it.x - cardW / 2,
      right: it.x + cardW / 2,
      top: it.y - cardH,
      bottom: it.y,
    };

    const offscreen =
      box.right < -margin ||
      box.left > viewport.width + margin ||
      box.bottom < -margin ||
      box.top > viewport.height + margin;

    if (offscreen) {
      result.set(it.id, { visible: false, absorbed: 0 });
      continue;
    }

    const hit = placed.find((p) => overlaps(p.box, box));
    if (hit) {
      result.set(it.id, { visible: false, absorbed: 0, absorbedIds: [] });
      const survivor = result.get(hit.id);
      survivor.absorbed += 1;
      survivor.absorbedIds.push(it.id); // remember WHO was hidden here, for the "+N" reveal
    } else {
      placed.push({ box, id: it.id });
      result.set(it.id, { visible: true, absorbed: 0, absorbedIds: [] });
    }
  }
  return result;
}
