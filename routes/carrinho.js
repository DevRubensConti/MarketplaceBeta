const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const { requireLogin } = require('../middlewares/auth');

// GET: Exibir carrinho
router.get('/carrinho', requireLogin, async (req, res) => {
  const carrinho = req.session.carrinho || [];

  if (carrinho.length === 0) {
    return res.render('carrinho', { itens: [], total: 0 });
  }

  const ids = carrinho.map(i => i.id);

  const { data: produtos, error } = await supabase
    .from('produtos')
    .select('*')
    .in('id', ids);

  if (error) {
    console.error('Erro ao buscar produtos do carrinho:', error);
    return res.status(500).send('Erro ao buscar produtos');
  }

  const itens = produtos.map(produto => {
    const itemCarrinho = carrinho.find(i => String(i.id) === String(produto.id));

    return {
      ...produto,
      quantidade: itemCarrinho ? itemCarrinho.quantidade : 1
    };
  });

  const total = itens.reduce((acc, item) => acc + (item.preco * item.quantidade), 0);

  res.render('carrinho', { itens, total });
});

// POST: Adicionar ao carrinho
router.post('/carrinho/adicionar/:id', requireLogin, (req, res) => {
  const produtoId = req.params.id;

  if (!req.session.carrinho) {
    req.session.carrinho = [];
  }

  // Garante que a comparação será confiável
  const itemExistente = req.session.carrinho.find(item => String(item.id) === String(produtoId));

  if (itemExistente) {
    itemExistente.quantidade += 1;
  } else {
    req.session.carrinho.push({ id: String(produtoId), quantidade: 1 });
  }

  res.redirect('/carrinho');
});


// POST: Remover do carrinho
router.post('/carrinho/remover/:id', requireLogin, (req, res) => {
  const produtoId = req.params.id;

  if (!req.session.carrinho) {
    req.session.carrinho = [];
  }

  req.session.carrinho = req.session.carrinho.filter(i => String(i.id) !== String(produtoId));

  res.redirect('/carrinho');
});


module.exports = router;
