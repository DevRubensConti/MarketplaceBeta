// Converte "1.234,56" | "1234.56" | "R$ 1.234,56" -> 1234.56 (Number)
function parsePrecoFlex(valor) {
  if (valor == null) return null;
  let s = String(valor).trim().replace(/[^\d.,-]/g, '');
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function toCentavos(n) {
  if (n == null) return null;
  return Math.round(Number(n) * 100);
}

function formatarPrecoBR(n) {
  const v = Number(n);
  if (Number.isNaN(v)) return '';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

module.exports = { parsePrecoFlex, toCentavos, formatarPrecoBR };
