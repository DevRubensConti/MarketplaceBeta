const normalizeSimple = s =>
  (s ?? '').trim().toLowerCase().replace(/^\p{L}/u, c => c.toUpperCase());

module.exports = { normalizeSimple };