const express = require('express');
const router = express.Router();
const supabase = require('../supabase'); // caminho correto do seu client Supabase
const { requireLogin } = require('../middlewares/auth'); // ajuste se o nome estiver diferente


router.get('/pedidos', requireLogin, async (req, res) => {
  const usuario = req.session.usuario;

  if (usuario.tipo !== 'pf') {
    return res.status(403).send('Apenas usuários PF podem acessar seus pedidos.');
  }

  const { data: pedidos, error: erroPedidos } = await supabase
    .from('pedidos')
    .select('id, data, status')
    .eq('usuario_id', usuario.id)
    .order('data', { ascending: false });

  if (erroPedidos) {
    console.error(erroPedidos);
    return res.status(500).send('Erro ao buscar pedidos');
  }

  const pedidoIds = pedidos.map(p => p.id);
  const { data: itens, error: erroItens } = await supabase
    .from('pedidos_itens')
    .select('pedido_id, quantidade, preco_unitario, produtos(nome)')
    .in('pedido_id', pedidoIds);

  if (erroItens) {
    console.error(erroItens);
    return res.status(500).send('Erro ao buscar itens');
  }

  const pedidosComItens = pedidos.map(pedido => {
    const itensDoPedido = itens.filter(item => item.pedido_id === pedido.id);
    return { ...pedido, itens: itensDoPedido };
  });

  res.render('painel-pedidos', { pedidos: pedidosComItens });
});

router.post('/checkout', requireLogin, async (req, res) => {
  const usuario_id = req.session.usuario?.id;
  const tipo_usuario = req.session.usuario?.tipo;
  const carrinho = req.session.carrinho || [];

  if (carrinho.length === 0) {
    return res.redirect('/carrinho');
  }

  // Busca os dados dos produtos
  const ids = carrinho.map(i => i.id);
  const { data: produtos, error: erroProdutos } = await supabase
    .from('produtos')
    .select('*')
    .in('id', ids);

  if (erroProdutos || !produtos) {
    return res.status(500).send('Erro ao buscar produtos do carrinho.');
  }

  // Cria o pedido
  const { data: pedidoCriado, error: erroPedido } = await supabase
    .from('pedidos')
    .insert([{
      usuario_id,
      tipo_usuario,
      status: 'pendente'
    }])
    .select()
    .single();

  if (erroPedido) {
    console.error('Erro ao criar pedido:', erroPedido);
    return res.status(500).send('Erro ao finalizar pedido.');
  }

  const pedido_id = pedidoCriado.id;

  // Cria os itens do pedido
  const itensPedido = produtos.map(produto => {
    const itemCarrinho = carrinho.find(i => i.id === produto.id);
    return {
      pedido_id,
      produto_id: produto.id,
      quantidade: itemCarrinho.quantidade,
      preco_unitario: produto.preco
    };
  });

  const { error: erroItens } = await supabase
    .from('pedidos_itens')
    .insert(itensPedido);

  if (erroItens) {
    console.error('Erro ao salvar itens do pedido:', erroItens);
    return res.status(500).send('Erro ao registrar itens do pedido.');
  }

  // Limpa o carrinho
  req.session.carrinho = [];

  res.redirect('/pedidos');
});


module.exports = router;