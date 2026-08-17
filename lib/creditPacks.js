// Server-side source of truth for wallet pricing. Unchanged from the
// Netlify version — the browser can only ever send a packId
// ('pack_5', 'pack_15', ...) — never an amount — so the actual ₹ price
// is always looked up here, never trusted from the client.
//
// 1 export = EXPORT_COST_CREDITS credits. Base rate is ₹10/credit,
// matching the old flat ₹50-per-export price at the smallest pack.

const EXPORT_COST_CREDITS = 5;
// First-time signup bonus. Bumped from 5 -> 50 credits so a brand-new
// user gets 10 free exports to try the product before ever needing to
// pay, instead of just 1.
const FREE_SIGNUP_CREDITS = 50;
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

// ---------------------------------------------------------
// CUSTOM CREDIT AMOUNT — lets a user type in any number of credits on
// the Wallet page instead of only picking a fixed pack. Same
// volume-discount idea as CREDIT_PACKS above (bigger amount = bigger
// per-credit discount), just expressed as thresholds so ANY quantity
// gets priced consistently rather than only the 5 fixed pack sizes.
// The breakpoints below match the discount % already used by the
// packs of that size (15 -> 10%, 30 -> 20%, 60 -> 30%, 120 -> 40%),
// so a custom amount of e.g. 45 credits lands on the same 20% tier
// pack_30 already uses, and never charges more than the equivalent
// fixed pack would.
//
// This is server-side pricing, same as CREDIT_PACKS — the browser only
// ever sends how many credits it wants; the ₹ price is always computed
// here, never trusted from the client.
const CUSTOM_CREDIT_MIN = 1;
const CUSTOM_CREDIT_MAX = 100000;
const CUSTOM_CREDIT_DISCOUNT_TIERS = [
  { minCredits: 120, discountPct: 40 },
  { minCredits: 60, discountPct: 30 },
  { minCredits: 30, discountPct: 20 },
  { minCredits: 15, discountPct: 10 },
  { minCredits: 1, discountPct: 0 }
];

function discountForCredits(credits) {
  const tier = CUSTOM_CREDIT_DISCOUNT_TIERS.find((t) => credits >= t.minCredits);
  return tier ? tier.discountPct : 0;
}

// Returns null if credits is not a valid whole number in range.
function priceForCustomCredits(credits) {
  if (!Number.isInteger(credits) || credits < CUSTOM_CREDIT_MIN || credits > CUSTOM_CREDIT_MAX) {
    return null;
  }
  const discountPct = discountForCredits(credits);
  const priceRupees = Math.round(credits * BASE_RUPEES_PER_CREDIT * (1 - discountPct / 100));
  return { credits, priceRupees, discountPct };
}

module.exports = {
  CREDIT_PACKS, getPack, EXPORT_COST_CREDITS, FREE_SIGNUP_CREDITS, BASE_RUPEES_PER_CREDIT,
  CUSTOM_CREDIT_MIN, CUSTOM_CREDIT_MAX, discountForCredits, priceForCustomCredits
};