// Server-side source of truth for wallet pricing. The browser can only
// ever send a packId ('pack_5', 'pack_15', ...) — never an amount — so
// the actual ₹ price is always looked up here, never trusted from the
// client. Bigger packs get a steeper per-credit discount, which is the
// incentive to top up in bulk instead of one credit at a time.
//
// 1 export = EXPORT_COST_CREDITS credits. Base rate is ₹10/credit,
// matching the old flat ₹50-per-export price at the smallest pack.

const EXPORT_COST_CREDITS = 5;
const FREE_SIGNUP_CREDITS = 5;
const BASE_RUPEES_PER_CREDIT = 10;

const CREDIT_PACKS = [
  { id: 'pack_5', credits: 5, priceRupees: 50, discountPct: 0 },
  { id: 'pack_15', credits: 15, priceRupees: 135, discountPct: 10 },
  { id: 'pack_30', credits: 30, priceRupees: 240, discountPct: 20 },
  { id: 'pack_60', credits: 60, priceRupees: 420, discountPct: 30 },
  { id: 'pack_120', credits: 120, priceRupees: 720, discountPct: 40 }
];

function getPack(packId) {
  return CREDIT_PACKS.find((p) => p.id === packId) || null;
}

module.exports = { CREDIT_PACKS, getPack, EXPORT_COST_CREDITS, FREE_SIGNUP_CREDITS, BASE_RUPEES_PER_CREDIT };
