// FEE_TABLE with canonical numbers (frozen according to the CONTRACT)
export const FEE_TABLE = {
  market_listing: { rate: 0.02, flat: 0, minimum: 1 },
  market_sale:    { rate: 0.05, flat: 0 },
  trade:          { rate: 0.02, flat: 0 },
  name_change:    { rate: 0,    flat: 500 },
  respec:         { rate: 0,    flat: 250 },
};

// Calculate fees for a given fee key and amount of gold
export function feeFor(feeKey, amountGold) {
  if (!Number.isSafeInteger(amountGold) || amountGold < 0) {
    throw new TypeError(`feeFor: amountGold must be a non-negative safe integer, got ${JSON.stringify(amountGold)}`);
  }
  const entry = FEE_TABLE[feeKey];
  if (!entry) throw new Error(`Unknown feeKey: ${feeKey}`);

  const baseFee = Math.floor(amountGold * entry.rate);
  const fee = baseFee + (entry.flat || 0);

  let feeGold;
  if (feeKey === 'market_listing' && amountGold > 0) {
    feeGold = Math.max(fee, entry.minimum);
  } else {
    feeGold = fee;
  }

  // A fee larger than the amount is NOT silently clamped to a zero net: that would hide a
  // caller charging 500 gold (name_change) against a 100-gold transaction, leaving the
  // player short with no signal anywhere. netGold is the honest arithmetic (never below
  // zero, because a negative net is meaningless to a caller) and `exceeds` tells the
  // caller the fee does not fit, so the action must be refused before it is charged.
  const exceeds = feeGold > amountGold;
  const netGold = exceeds ? 0 : amountGold - feeGold;
  return { feeGold, netGold, rate: entry.rate, flat: entry.flat, exceeds };
}

// Describe the fee key with a human-readable string
export function describeFee(feeKey) {
  const entry = FEE_TABLE[feeKey];
  if (!entry) throw new Error(`Unknown feeKey: ${feeKey}`);

  if (feeKey === 'market_listing') {
    return 'Market listing fee: 2% of asking price, minimum 1 gold';
  } else if (feeKey === 'market_sale') {
    return 'Market sale fee: 5% of sale price';
  } else if (feeKey === 'trade') {
    return 'Trade fee: 2% of the gold side (flat 0)';
  } else if (feeKey === 'name_change') {
    return 'Name change fee: flat 500 gold';
  } else if (feeKey === 'respec') {
    return 'Respec fee: flat 250 gold';
  }

  return 'Fee description unavailable';
}