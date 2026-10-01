import { FEE_TABLE, feeFor, describeFee } from './fees.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✔️  ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌  ${name} — ${err.message}`);
    failed++;
  }
}

// Test 1: Every FEE_KEY exists in FEE_TABLE
const FEE_KEYS = ['market_listing', 'market_sale', 'trade', 'name_change', 'respec'];
test('All FEE_KEYS exist in FEE_TABLE', () => {
  FEE_KEYS.forEach(key => assert(key in FEE_TABLE, `${key} missing in FEE_TABLE`));
});

// Test 2: feeGold always rounds down
const roundTests = [
  { feeKey: 'market_sale', amountGold: 19, expectedFee: 0 },
  { feeKey: 'market_sale', amountGold: 20, expectedFee: 1 },
];
roundTests.forEach(({ feeKey, amountGold, expectedFee }) => {
  test(`feeGold rounds down for ${feeKey} (${amountGold} gold)`, () => {
    const { feeGold } = feeFor(feeKey, amountGold);
    assert(feeGold === expectedFee, `Expected fee: ${expectedFee}, got: ${feeGold}`);
  });
});

// Test 3: market_listing minimum fee applies correctly
test('market_listing charges minimum fee of 1 gold when amount > 0', () => {
  const result = feeFor('market_listing', 1);
  assert(result.feeGold === 1, `Expected fee: 1, got: ${result.feeGold}`);
});

test('market_listing charges 0 gold on 0 amount', () => {
  const result = feeFor('market_listing', 0);
  assert(result.feeGold === 0, `Expected fee: 0, got: ${result.feeGold}`);
});

// Test 4: Fixed amounts for name_change and respec
test('name_change charges exactly 500 gold', () => {
  const result = feeFor('name_change', 10000);
  assert(result.feeGold === 500, `Expected fee: 500, got: ${result.feeGold}`);
});

test('respec charges exactly 250 gold', () => {
  const result = feeFor('respec', 10000);
  assert(result.feeGold === 250, `Expected fee: 250, got: ${result.feeGold}`);
});

// Test 5: netGold never negative
test('netGold is never negative', () => {
  const result = feeFor('respec', 100);
  assert(result.netGold === 0, `Expected netGold: 0, got: ${result.netGold}`);
});

// Test 6: describeFee returns strings and throws on unknown keys
test('describeFee returns non-empty string for all keys', () => {
  FEE_KEYS.forEach(key => {
    const description = describeFee(key);
    assert(description.length > 0, `Empty description for key: ${key}`);
  });
});

test('describeFee throws on unknown feeKey', () => {
  let threw = false;
  try { describeFee('unknown_key'); } catch { threw = true; }
  assert(threw, 'describeFee did not throw on unknown key');
});

// Test 7: feeFor throws on unknown or invalid input
test('feeFor throws on unknown feeKey', () => {
  let threw = false;
  try { feeFor('unknown_key', 100); } catch { threw = true; }
  assert(threw, 'feeFor did not throw on unknown key');
});

test('feeFor throws on negative amountGold', () => {
  let threw = false;
  try { feeFor('market_sale', -1); } catch { threw = true; }
  assert(threw, 'feeFor did not throw on negative amountGold');
});

console.log(`==== ${passed} passed, ${failed} failed ====`);
process.exit(failed ? 1 : 0);