const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const { requireLogin } = require('../middlewares/auth'); // ✅ Correto

// GET: Exibir carrinho
router.get('/carrinho', requireLogin, async (req, res) => {
  const carrinho = req.session.carrinho || [];

  if (carrinho.length === 0) {
    return res.render('carrinho', { itens: [] });
  }

  const ids = carrinho.map(i => i.id);
  const { data: produtos, error } = await supabase
    .from('produtos')
    .select('*')
    .in('id', ids);

  if (error) return res.status(500).send('Erro ao buscar produtos');

  const itens = produtos.map(produto => {
    const itemCarrinho = carrinho.find(i => i.id === produto.id);
    return {
      ...produto,
      quantidade: itemCarrinho.quantidade
    };
  });

  res.render('carrinho', { itens });
});

// POST: Adicionar ao carrinho
router.post('/carrinho/adicionar/:id', requireLogin, (req, res) => {
  const produtoId = req.params.id;

  if (!req.session.carrinho) {
    req.session.carrinho = [];
  }

  const itemExistente = req.session.carrinho.find(item => item.id === produtoId);

  if (itemExistente) {
    itemExistente.quantidade += 1;
  } else {
    req.session.carrinho.push({ id: produtoId, quantidade: 1 });
  }

  res.redirect('/carrinho');
});

// POST: Remover do carrinho
router.post('/carrinho/remover/:id', requireLogin, (req, res) => {
  const produtoId = req.params.id;

  if (!req.session.carrinho) {
    return res.redirect('/carrinho');
  }

  req.session.carrinho = req.session.carrinho.filter(item => item.id !== produtoId);

  res.redirect('/carrinho');
});

module.exports = router;
