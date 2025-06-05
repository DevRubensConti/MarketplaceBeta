const express = require('express');
const router = express.Router();
const supabase = require('../supabase');

// Página inicial - lista de produtos recentes
router.get('/', async (req, res) => {
  const { data: produtos, error: prodError } = await supabase
    .from('produtos')
    .select('*')
    .order('id', { ascending: false })
    .limit(8);

  const { data: lojasTop, error: lojasError } = await supabase
    .from('usuarios_pj')
    .select('id, nomeFantasia, icone_url, nota')
    .order('nota', { ascending: false })
    .limit(10);

  if (prodError || lojasError) {
    console.error('Erro ao buscar dados:', prodError || lojasError);
    return res.status(500).send('Erro ao buscar dados.');
  }

  res.render('index', { produtos, lojasTop });
});

// Página de plano de assinatura
router.get('/plano-assinatura', (req, res) => {
  res.render('plano-assinatura');
});

// Página de teste de sessão (opcional para debug)
router.get('/teste', (req, res) => {
  console.log('req.session:', req.session);
  console.log('req.session.usuario:', req.session.usuario);
  res.send({
    session: req.session,
    usuario: req.session.usuario
  });
});

module.exports = router;
