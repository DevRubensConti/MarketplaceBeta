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

router.get('/api/carrinho', async (req, res) => {
  const usuarioId = req.session.usuario.id;
  const tipoUsuario = req.session.usuario.tipo; // 'pf' ou 'pj'

  const { data: itens, error } = await supabase
    .from('carrinho')
    .select(`
      *,
      produtos (
        nome,
        preco,
        imagem_url
      )
    `)
    .eq('usuario_id', usuarioId)
    .eq('tipo_usuario', tipoUsuario);

  if (error) {
    console.error(error);
    return res.status(500).json([]);
  }

  res.json(itens);
});

router.post('/api/carrinho/adicionar/:id', async (req, res) => {
  const produtoId = req.params.id;
  const usuarioId = req.session.usuario.id;
  const tipoUsuario = req.session.usuario.tipo; // 'pf' ou 'pj'

  // Verifica se já existe no carrinho
  const { data: existente, error: erroExistente } = await supabase
    .from('carrinho')
    .select('*')
    .eq('usuario_id', usuarioId)
    .eq('tipo_usuario', tipoUsuario)
    .eq('produto_id', produtoId)
    .single();

  if (erroExistente) console.error(erroExistente);

  if (existente) {
    // Atualiza quantidade
    const { error } = await supabase
      .from('carrinho')
      .update({ quantidade: existente.quantidade + 1 })
      .eq('id', existente.id);
    if (error) {
      console.error(error);
      return res.status(500).send('Erro ao atualizar quantidade');
    }
  } else {
    // Insere novo item
    const { error } = await supabase
      .from('carrinho')
      .insert([{
        usuario_id: usuarioId,
        tipo_usuario: tipoUsuario,
        produto_id: produtoId,
        quantidade: 1
      }]);
    if (error) {
      console.error(error);
      return res.status(500).send('Erro ao adicionar ao carrinho');
    }
  }

  res.status(200).send('Item adicionado ao carrinho');
});


// Incrementa ou decrementa quantidade no carrinho
router.post('/api/carrinho/:id/:action', async (req, res) => {
  const itemId = req.params.id;
  const action = req.params.action;

  const { data: item, error: errorItem } = await supabase
    .from('carrinho')
    .select('*')
    .eq('id', itemId)
    .single();

  if (errorItem || !item) {
    console.error(errorItem);
    return res.status(404).send('Item não encontrado');
  }

  let novaQtd = item.quantidade;
  if (action === 'plus') novaQtd++;
  if (action === 'minus' && novaQtd > 1) novaQtd--;

  const { error } = await supabase
    .from('carrinho')
    .update({ quantidade: novaQtd })
    .eq('id', itemId);

  if (error) {
    console.error(error);
    return res.status(500).send('Erro ao atualizar quantidade');
  }

  res.status(200).send('Quantidade atualizada');
});



module.exports = router;
