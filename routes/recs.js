// routes/recs.js
const express = require('express');
const router = express.Router();
const supabaseDb = require('../supabase/supabaseDb'); // service_role (DB)

function getIdentity(req) {
  const user = req.session?.usuario;
  const userId = user?.id || null;         // PF/PJ logado
  const sessionId = req.sessionID;          // anônimo
  return { userId, sessionId };
}

// 3.1 Log de evento
router.post('/api/recs/event', async (req, res) => {
  const { item_id, event_type } = req.body; // 'view' | 'add_to_cart' | 'purchase' | 'favorite'
  const { userId, sessionId } = getIdentity(req);

  const { error } = await supabaseDb
    .from('user_events')
    .insert({ user_id: userId, session_id: sessionId, item_id, event_type });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// 3.2 Recs da HOME
router.get('/api/recs/home', async (req, res) => {
  const { categoria } = req.query || {};
  const { data, error } = await supabaseDb.rpc('recs_home', { categoria_in: categoria || null });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// 3.3 Recs da página de produto (fusão simples)
router.get('/api/recs/item/:id', async (req, res) => {
  const itemId = req.params.id;
  const { data: covis, error: e1 }   = await supabaseDb.rpc('recs_covis',    { item_in: itemId });
  const { data: conte, error: e2 }   = await supabaseDb.rpc('recs_conteudo', { item_in: itemId });
  if (e1 || e2) return res.status(500).json({ error: (e1||e2).message });

  // mescla e ranqueia
  const map = new Map();
  const add = (arr, w) => arr.forEach(r => {
    const id = r.id || r.recomendado_id;
    const prev = map.get(id) || { id };
    const score = (prev.score || 0) + (r.score || 0) * w;
    map.set(id, { id, score });
  });
  add(covis || [], 0.6);
  add(conte || [], 0.4);

  const ids = [...map.values()].sort((a,b)=>b.score-a.score).slice(0,12).map(x=>x.id);

  // traz campos do produto
  const { data: produtos, error: e3 } = await supabaseDb
    .from('produtos')
    .select('id,nome,preco,imagem_url')
    .in('id', ids);

  if (e3) return res.status(500).json({ error: e3.message });

  // mantém a ordem por score
  const order = new Map(ids.map((id,i)=>[id,i]));
  res.json((produtos||[]).sort((a,b)=>order.get(a.id)-order.get(b.id)));
});

module.exports = router;
