// Friendly guest names (<= 13 chars so they always fit the 14-char name field).
const ADJ = ['Mossy', 'Quiet', 'Brave', 'Merry', 'Misty', 'Swift', 'Amber', 'Dusky', 'Cozy', 'Lucky', 'Gentle', 'Hearty', 'Sunny', 'Wily'];
const NOUN = ['Pip', 'Wren', 'Fern', 'Juniper', 'Bramble', 'Thistle', 'Maple', 'Willow', 'Clover', 'Ember', 'Rook', 'Sage', 'Hazel', 'Birch', 'Lark', 'Briar', 'Pebble', 'Nettle'];
export function randomName(taken = () => false) {
  for (let i = 0; i < 30; i++) {
    const n = `${ADJ[Math.floor(Math.random() * ADJ.length)]} ${NOUN[Math.floor(Math.random() * NOUN.length)]}`;
    if (n.length <= 14 && !taken(n)) return n;
  }
  return `Wayfarer ${Math.floor(Math.random() * 90 + 10)}`;
}
