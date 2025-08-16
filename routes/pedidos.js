const express = require('express');
const router = express.Router();
const supabase = require('../supabase'); // caminho correto do seu client Supabase
const { requireLogin } = require('../middlewares/auth'); // ajuste se o nome estiver diferente


router.get('/meus-pedidos', requireLogin, async (req, res) => {
  const compradorId = req.session.usuario.id;

  // 1) Buscar pedidos do comprador (PF ou PJ), sem embed
  const { data: pedidos, error } = await supabase
    .from('pedidos')
    .select('id, status, data_pedido, preco_total, quantidade, produto_id')
    .or(`comprador_pf_id.eq.${compradorId},comprador_pj_id.eq.${compradorId}`)
    .order('data_pedido', { ascending: false });

  if (error) {
    console.error('Erro ao buscar pedidos:', error);
    return res.status(500).send('Erro ao buscar seus pedidos');
  }

  if (!pedidos || pedidos.length === 0) {
    return res.render('meus-pedidos', { pedidos: [] });
  }

  // 2) Buscar produtos em lote
  const produtoIds = [...new Set(pedidos.map(p => p.produto_id).filter(Boolean))];
  let produtosById = {};
  if (produtoIds.length > 0) {
    const { data: produtos, error: prodErr } = await supabase
      .from('produtos')
      .select('id, nome, imagem_url')
      .in('id', produtoIds);

    if (prodErr) {
      console.error('Erro ao buscar produtos:', prodErr);
    } else {
      produtosById = Object.fromEntries((produtos || []).map(pr => [pr.id, pr]));
    }
  }

  // 3) Anexar produto (se existir)
  const pedidosComProduto = pedidos.map(p => ({
    ...p,
    produto: produtosById[p.produto_id] || null
  }));

  res.render('meus-pedidos', { pedidos: pedidosComProduto });
});


router.get('/minhas-vendas', requireLogin, async (req, res) => {
  const vendedorId = req.session.usuario.id;

  const { data: vendas, error } = await supabase
    .from('pedidos')
    .select(`
      id,
      status,
      data_pedido,
      preco_total,
      quantidade,
      produto:produtos (
        id,
        nome,
        imagem_url
      ),
      comprador_pf:usuarios_pf (
        id,
        nome
      ),
      comprador_pj:usuarios_pj (
        id,
        nomeFantasia
      )
    `)
    // vendedor pode estar em uma das duas colunas
    .or(`vendedor_pf_id.eq.${vendedorId},vendedor_pj_id.eq.${vendedorId}`)
    .order('data_pedido', { ascending: false });

  if (error) {
    console.error('Erro ao buscar vendas:', error);
    return res.status(500).send('Erro ao buscar suas vendas');
  }

  res.render('minhas-vendas', { vendas });
});


router.get('/checkout',requireLogin, async (req, res) => {
  const usuarioId = req.session.usuario.id;
  const tipoUsuario = req.session.usuario.tipo;

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
    return res.status(500).send('Erro ao carregar checkout');
  }

  res.render('checkout', { itens });
});


router.post('/checkout', async (req, res) => {
  const usuarioId = req.session.usuario.id;   // COMPRADOR (PF ou PJ)
  const tipoUsuario = req.session.usuario.tipo; // 'pf' | 'pj'

  // 1) Busca itens do carrinho
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
    console.error('Erro carrinho:', error);
    return res.status(500).send('Erro ao finalizar compra');
  }
  if (!itens || itens.length === 0) {
    return res.status(400).send('Seu carrinho está vazio.');
  }

  // 2) Cria pedidos item a item
  for (const item of itens) {
    // 2.1 Busca o produto com tipo do VENDEDOR e quantidade (para validar estoque)
    const { data: produto, error: produtoError } = await supabase
      .from('produtos')
      .select('usuario_id, tipo_usuario, preco, quantidade')
      .eq('id', item.produto_id)
      .single();

    if (produtoError || !produto) {
      console.error('Erro ao buscar produto no checkout:', produtoError);
      continue; // pula este item
    }

    // 2.2 Validação simples de estoque
    const qtdComprada = parseInt(item.quantidade, 10) || 1;
    if (produto.quantidade == null || produto.quantidade < qtdComprada) {
      console.warn(`Estoque insuficiente para produto ${item.produto_id}. Em estoque: ${produto.quantidade}, pedido: ${qtdComprada}`);
      continue;
    }

    // 2.3 Monta payload com COMPRADOR (PF/PJ) e VENDEDOR (PF/PJ)
    const payloadPedido = {
      // Comprador (uma das duas colunas)
      ...(tipoUsuario === 'pj'
        ? { comprador_pj_id: usuarioId }
        : { comprador_pf_id: usuarioId }),

      // (opcional) manter o tipo do comprador no pedido
      tipo_usuario: tipoUsuario,

      // Pedido/produto
      produto_id: item.produto_id,
      quantidade: qtdComprada,
      preco_total: (produto.preco || 0) * qtdComprada,
      status: 'Em processamento',
      data_pedido: new Date(),

      // Vendedor (uma das duas colunas, conforme o produto)
      ...(produto.tipo_usuario === 'pj'
        ? { vendedor_pj_id: produto.usuario_id }
        : { vendedor_pf_id: produto.usuario_id })
    };

    // 2.4 Insere pedido
    const { error: pedidoError } = await supabase
      .from('pedidos')
      .insert([payloadPedido]);

    if (pedidoError) {
      console.error('Erro ao inserir pedido:', pedidoError);
      continue;
    }

    // 2.5 Decrementa estoque via RPC
    const { error: decErr } = await supabase.rpc('decrementa_estoque', {
      p_id: item.produto_id,
      p_qtd: qtdComprada
    });
    if (decErr) {
      console.error(`Erro ao decrementar estoque do produto ${item.produto_id}:`, decErr);
      // opcional: reverter o pedido aqui se quiser consistência estrita
    }
  }

  // 3) Limpa carrinho do comprador
  const { error: delErr } = await supabase
    .from('carrinho')
    .delete()
    .eq('usuario_id', usuarioId)
    .eq('tipo_usuario', tipoUsuario);

  if (delErr) {
    console.error('Erro ao limpar carrinho:', delErr);
  }

  // 4) Renderiza página de confirmação
  res.render('checkout', { itens });
});



router.post('/checkout/finalizar', async (req, res) => {
  const usuarioId = req.session.usuario.id;   // COMPRADOR (PF ou PJ)
  const tipoUsuario = req.session.usuario.tipo; // 'pf' | 'pj'

  // 1) Carrega itens do carrinho do comprador
  const { data: itens, error } = await supabase
    .from('carrinho')
    .select('*')
    .eq('usuario_id', usuarioId)
    .eq('tipo_usuario', tipoUsuario);

  if (error) {
    console.error('Erro carrinho:', error);
    return res.status(500).send('Erro ao finalizar compra');
  }
  if (!itens || itens.length === 0) {
    return res.status(400).send('Seu carrinho está vazio.');
  }

  // 2) Processa item a item
  for (const item of itens) {
    // Busca produto com tipo do VENDEDOR e estoque
    const { data: produto, error: produtoError } = await supabase
      .from('produtos')
      .select('usuario_id, tipo_usuario, preco, quantidade')
      .eq('id', item.produto_id)
      .single();

    if (produtoError || !produto) {
      console.error('Erro ao buscar produto no checkout:', produtoError);
      continue;
    }

    const qtdComprada = parseInt(item.quantidade, 10) || 1;

    // Validação simples de estoque
    if (produto.quantidade == null || produto.quantidade < qtdComprada) {
      console.warn(`Estoque insuficiente para produto ${item.produto_id}. Em estoque: ${produto.quantidade}, pedido: ${qtdComprada}`);
      continue;
    }

    // Monta payload com COMPRADOR (PF/PJ) e VENDEDOR (PF/PJ)
    const payloadPedido = {
      // Comprador (preencha UMA das duas colunas)
      ...(tipoUsuario === 'pj'
        ? { comprador_pj_id: usuarioId }
        : { comprador_pf_id: usuarioId }),

      // (opcional) manter tipo do comprador no registro de pedido
      tipo_usuario: tipoUsuario,

      // Produto/pedido
      produto_id: item.produto_id,
      quantidade: qtdComprada,
      preco_total: (produto.preco || 0) * qtdComprada,
      status: 'Em processamento',
      data_pedido: new Date(),

      // Vendedor (preencha UMA das duas colunas)
      ...(produto.tipo_usuario === 'pj'
        ? { vendedor_pj_id: produto.usuario_id }
        : { vendedor_pf_id: produto.usuario_id })
    };

    // Insere pedido
    const { error: pedidoError } = await supabase
      .from('pedidos')
      .insert([payloadPedido]);

    if (pedidoError) {
      console.error('Erro ao inserir pedido:', pedidoError);
      continue;
    }

    // Decrementa estoque via RPC (atômico)
    const { error: decErr } = await supabase.rpc('decrementa_estoque', {
      p_id: item.produto_id,
      p_qtd: qtdComprada
    });
    if (decErr) {
      console.error(`Erro ao decrementar estoque do produto ${item.produto_id}:`, decErr);
      // opcional: reverter o pedido aqui se quiser consistência estrita
    }
  }

  // 3) Limpa carrinho após criar pedidos
  const { error: delErr } = await supabase
    .from('carrinho')
    .delete()
    .eq('usuario_id', usuarioId)
    .eq('tipo_usuario', tipoUsuario);

  if (delErr) console.error('Erro ao limpar carrinho:', delErr);

  res.redirect('/meus-pedidos');
});




module.exports = router;