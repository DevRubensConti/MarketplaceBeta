
const express = require('express');
const router = express.Router();
const supabaseDb = require('../supabase/supabaseDb');
const { requireLogin } = require('../middlewares/auth');
const upload = require('../middlewares/upload');
const { parsePrecoFlex, toCentavos } = require('../utils/preco'); 
const { normalizeSimple } = require('../utils/normalizeText'); 

// Detecta se a requisição espera JSON (fetch/AJAX ou Accept: application/json)
function wantsJson(req) {
  return (
    req.get('X-Requested-With') === 'fetch' ||      // fetch no front
    req.xhr === true ||                              // AJAX "clássico"
    req.accepts(['html', 'json']) === 'json' ||      // header Accept prioriza JSON
    (req.get('Accept') || '').includes('application/json') ||
    (req.headers['content-type'] || '').includes('application/json')
  );
}


// Página inicial de listagem (sem filtros aplicados)
router.get('/listings', (req, res) => {
  res.render('listings');
});

// Página de fallback (acesso direto sem ID)
router.get('/item', (req, res) => {
  res.render('item');
});

// Página protegida de cadastro de item
router.get('/cadastro-item', requireLogin, (req, res) => {
  res.render('cadastro-item');
});

// Listagem com filtros
router.get('/produtos', async (req, res) => {
  const {
    preco_min, preco_max,
    marca, tipo, categoria, shape,
    condicao, acabamento, cor, promo,
    pesquisa
  } = req.query;

  const toArr = v => v ? (Array.isArray(v) ? v : [v]) : [];

  let query = supabaseDb.from('produtos').select('*');

  // Preço: aplique apenas quando vier número válido
  const min = parseFloat(preco_min);
  if (!isNaN(min) && min > 0) query = query.gte('preco', min);

  // Ajuste o default (1.000.000) para bater com seu EJS
  const max = parseFloat(preco_max);
  if (!isNaN(max) && max < 1_000_000) query = query.lte('preco', max);

  // Filtros simples
  if (condicao && condicao.trim())    query = query.eq('condicao', condicao);
  if (acabamento && acabamento.trim())query = query.eq('acabamento', acabamento);
  // ...
  if (cor && cor.trim()) {
    const corLike = `%${cor.trim().replace(/[%_]/g, '\\$&')}%`;
    query = query.ilike('cor', corLike);
  }
  // ...

  if (promo != null)                  query = query.eq('em_promocao', true);

  // Arrays
  if (marca)     query = query.in('marca',     toArr(marca));
  if (tipo)      query = query.in('tipo',      toArr(tipo));
  if (categoria) query = query.in('categoria', toArr(categoria));
  if (shape)     query = query.in('shape',     toArr(shape).map(s => String(s).trim()));

  // Busca livre
  if (pesquisa && pesquisa.trim()) {
    const safe = pesquisa.trim().replace(/[%_]/g, '\\$&'); // escapa curingas
    const like = `%${safe}%`;

    const orParts = [
      `nome.ilike.${like}`,
      `descricao.ilike.${like}`,
      `tags.ilike.${like}`,
      `shape.ilike.${like}`,
      `cor.ilike.${like}`,
      `marca.ilike.${like}`,
      `modelo.ilike.${like}`,
      `categoria.ilike.${like}`,
      `tipo.ilike.${like}`,
      `captadores_config.ilike.${like}`,
      `madeira.ilike.${like}`,
      `acabamento.ilike.${like}`,
      `condicao.ilike.${like}`,
      `pais_fabricacao.ilike.${like}`,
      // ⚠️ Não usar cast aqui (ano_fabricacao::text.ilike) — PostgREST não aceita no .or
    ];

    // Se o termo tem um ano (ex.: 1998, 2008...), adiciona OR de igualdade numérica
    const years = Array.from(safe.matchAll(/\b(19|20)\d{2}\b/g)).map(m => m[0]);
    years.forEach(y => {
      orParts.push(`ano_fabricacao.eq.${y}`);
    });

    query = query.or(orParts.join(','));
  }

  const { data: produtos, error } = await query.order('created_at', { ascending: false });

  if (error) {
    console.error('Erro ao buscar produtos:', error);
    return res.status(500).send('Erro ao buscar produtos');
  }

  res.render('listings', { produtos, query: req.query, mensagens: [], urlAtual: req.originalUrl });
});




// Página de detalhes do item
router.get('/item/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 1) Produto com agregados
    const { data: item, error: itemErr } = await supabaseDb
      .from('produtos')
      .select(`
        id, nome, preco, imagem_url, descricao, condicao, marca, shape, modelo, cor,
        madeira, acabamento, pais_fabricacao, ano_fabricacao, captadores_config, cordas,
        tipo_usuario, usuario_id, acessos, created_at,
        nota_media, total_avaliacoes
      `)
      .eq('id', id)
      .maybeSingle();

    if (itemErr || !item) {
      console.error('Erro ao buscar item:', itemErr);
      return res.status(404).send('Produto não encontrado');
    }

    // Dias listado
    if (item.created_at) {
      const d = new Date(item.created_at);
      item.dias_listado = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
    } else {
      item.dias_listado = 0;
    }

    // 2) Incrementa acessos (RPC)
    const { error: incErr } = await supabaseDb.rpc('increment_acessos', { p_id: id });
    if (incErr) console.error('Erro ao incrementar acessos:', incErr);

    // 3) Dono (PF ou PJ) com agregados
    let dono = null;
    if (item.tipo_usuario === 'pj') {
      const { data, error: pjErr } = await supabaseDb
        .from('usuarios_pj')
        .select(`
          id, nomeFantasia, icone_url, descricao, itens_vendidos, cidade, estado, created_at,
          nota_media, total_avaliacoes
        `)
        .eq('id', item.usuario_id)
        .maybeSingle();
      dono = data;
      if (pjErr) console.error('Erro ao buscar usuário PJ:', pjErr);
    } else {
      const { data, error: pfErr } = await supabaseDb
        .from('usuarios_pf')
        .select(`
          id, nome, sobrenome, icone_url, descricao, itens_vendidos, cidade, estado,
          nota_media, total_avaliacoes
        `)
        .eq('id', item.usuario_id)
        .maybeSingle();
      dono = data;
      if (pfErr) console.error('Erro ao buscar usuário PF:', pfErr);
    }

    // 4) Reviews do produto (últimas 20)
    const { data: reviewsRaw, error: revErr } = await supabaseDb
      .from('avaliacoes_produtos')
      .select('id, usuario_id, nota, comentario, created_at')
      .eq('produto_id', id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (revErr) console.error('Erro ao buscar reviews do produto:', revErr);

    // 4.1) Enriquecer com nome + avatar do autor (PF ou PJ)
    let reviews = [];
    if (reviewsRaw && reviewsRaw.length > 0) {
      const userIds = [...new Set(reviewsRaw.map(r => r.usuario_id))];

      let pfMap = new Map(), pjMap = new Map();
      if (userIds.length > 0) {
        const [pfRes, pjRes] = await Promise.all([
          supabaseDb
            .from('usuarios_pf')
            .select('id, nome, sobrenome, icone_url')
            .in('id', userIds),
          supabaseDb
            .from('usuarios_pj')
            .select('id, nomeFantasia, icone_url')
            .in('id', userIds)
        ]);
        (pfRes.data || []).forEach(p => pfMap.set(p.id, p));
        (pjRes.data || []).forEach(p => pjMap.set(p.id, p));
      }

      const DEFAULT_AVATAR = process.env.DEFAULT_AVATAR_URL || '/images/chat-default.png';
      reviews = reviewsRaw.map(r => {
        const pf = pfMap.get(r.usuario_id);
        const pj = pjMap.get(r.usuario_id);
        const autor_nome = pf
          ? [pf.nome, pf.sobrenome].filter(Boolean).join(' ')
          : (pj?.nomeFantasia || 'Usuário');
        const autor_avatar = pf?.icone_url || pj?.icone_url || DEFAULT_AVATAR;
        return { ...r, autor_nome, autor_avatar };
      });
    }

    const { voltar } = req.query;
    return res.render('item', { item, dono, voltar, reviews });
  } catch (err) {
    console.error('Erro inesperado:', err);
    return res.status(500).send('Erro no servidor');
  }
});

router.post('/cadastro-item', requireLogin, upload.array('imagens', 12), async (req, res) => {
  try {
    const usuario_id  = req.session.usuario?.id;
    const tipo_usuario = req.session.usuario?.tipo;
    const files = req.files;

    // 🔹 [NOVO] Busca a loja do usuário para preencher loja_id no produto
    //    (se for PF e não tiver loja, loja_id ficará null e tudo bem)
    let loja_id = null;
    try {
      const { data: loja } = await supabaseDb
        .from('lojas')
        .select('id')
        .eq('usuario_id', usuario_id)
        .maybeSingle();

      if (loja?.id) loja_id = loja.id;
    } catch (e) {
      console.warn('Aviso: falha ao buscar loja para este usuário:', e?.message || e);
    }

    // Regra: pelo menos 1 imagem
    if (!files || files.length === 0) {
      if (wantsJson(req)) {
        return res.status(422).json({ error: 'Pelo menos uma imagem é obrigatória.' });
      }
      return res.status(400).send('Pelo menos uma imagem é obrigatória.');
    }

    const quantidade = parseInt(req.body.quantidade, 10);
    if (isNaN(quantidade) || quantidade < 0) {
      return res.status(400).send('Quantidade inválida. Deve ser maior ou igual a 0.');
    }

    // Upload das imagens
    const imagemUrls = [];
    for (const file of files) {
      const safeName = file.originalname.replace(/[^\w.\-]/g, '_');
      const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}_${safeName}`;

      const { error: uploadError } = await supabaseDb
        .storage
        .from('imagens')
        .upload(filename, file.buffer, { contentType: file.mimetype });

      if (uploadError) {
        console.error('Upload error:', uploadError);
        if (wantsJson(req)) return res.status(500).json({ error: 'Erro ao fazer upload de imagem.' });
        return res.status(500).send('Erro ao fazer upload de imagem.');
      }

      const { data: publicUrlData } = supabaseDb.storage.from('imagens').getPublicUrl(filename);
      imagemUrls.push(publicUrlData.publicUrl);
    }

    // Campos do body
    const {
      nome, descricao, preco, marca, marca_personalizada, tipo, condicao,
      tags, ano_fabricacao, cor, captadores_config, madeira,
      pais_fabricacao, cordas, categoria, shape, acabamento,
      outro_tipo,              // shape manual quando "Outro"
      modelo, modelo_outro    // modelo selecionado vs "Outro"
    } = req.body;

    // Marca final (respeita "Outra...")
    const marcaFinal = (marca === 'Outra...' ? marca_personalizada : marca)?.trim() || null;

    // Shape final
    const shapeFinal = (shape && shape.trim()) || (outro_tipo && outro_tipo.trim()) || null;

    // Modelo final
    const modeloFinal = (modelo === '__outro__')
      ? ((modelo_outro || '').trim() || null)
      : ((modelo || '').trim() || null);

    // Preço (pt-BR -> número)
    const precoFinal = (() => {
      const n = parsePrecoFlex(preco); // -> Number(1234.56) ou null
      if (n == null || n < 0) return null;
      return Math.round(n * 100) / 100;
    })();

    console.log('req.body.quantidade =', req.body?.quantidade);
    console.log('quantidade (parsed) =', quantidade);

    // Inserção no banco
    const { data: inserted, error: dbError } = await supabaseDb.from('produtos').insert([{
      nome: nome?.trim(),
      descricao,
      preco: precoFinal,
      marca: marcaFinal,
      tipo: tipo || null,
      categoria: categoria || null,
      condicao: condicao || null,
      imagem_url: imagemUrls.join(','), // CSV de URLs
      usuario_id,
      tipo_usuario,                      // PF/PJ
      loja_id,                           // 🔹 [NOVO] vincula à loja se existir
      ano_fabricacao: ano_fabricacao ? parseInt(ano_fabricacao) : null,
      captadores_config: captadores_config || null,
      madeira: madeira || null,
      tags: tags || null,
      pais_fabricacao: pais_fabricacao || null,
      cor: cor || null,
      acabamento: acabamento || null,
      cordas: cordas ? parseInt(cordas) : null,
      shape: shapeFinal,
      modelo: modeloFinal,
      quantidade: quantidade
    }]).select('id').single();

    if (dbError) {
      console.error('Erro ao cadastrar produto:', dbError);
      if (wantsJson(req)) return res.status(500).json({ error: 'Erro ao cadastrar item.' });
      return res.status(500).send('Erro ao cadastrar item.');
    }

    // Upsert no catálogo quando modelo novo é digitado
    try {
      if (marcaFinal && shapeFinal && modeloFinal) {
        const marcaN  = normalizeSimple(marcaFinal);
        const shapeN  = normalizeSimple(shapeFinal);
        const modeloN = normalizeSimple(modeloFinal);

        await supabaseDb.from('catalogo_modelos').upsert(
          { marca: marcaN, shape: shapeN, modelo: modeloN, ativo: true },
          { onConflict: 'marca,shape,modelo', ignoreDuplicates: true }
        );
      }
    } catch (e) {
      console.warn('Aviso: não foi possível atualizar catalogo_modelos:', e?.message || e);
    }

    // Sucesso
    const redirectUrl = (tipo_usuario === 'pj') ? '/painel/loja' : '/painel/usuario';
    if (wantsJson(req)) {
      return res.status(201).json({ ok: true, id: inserted?.id, redirect: redirectUrl });
    }
    return res.redirect(redirectUrl);

  } catch (err) {
    console.error('Erro inesperado no cadastro-item:', err);
    if (wantsJson(req)) return res.status(500).json({ error: 'Erro interno. Tente novamente.' });
    return res.status(500).send('Erro interno. Tente novamente.');
  }
});

router.get('/painel/produto/:id/editar', requireLogin, async (req, res) => {
  const produtoId = req.params.id;
  const usuario_id = req.session.usuario.id;

  const { data: produto, error } = await supabaseDb
    .from('produtos')
    .select('*')
    .eq('id', produtoId)
    .maybeSingle();

  if (error || !produto) {
    return res.status(404).send('Produto não encontrado.');
  }

  if (produto.usuario_id !== usuario_id) {
    return res.status(403).send('Acesso negado. Este produto não é seu.');
  }

  res.render('editar-item', { produto });
});

router.post('/painel/produto/:id/editar', requireLogin, async (req, res) => {
  try {
    const produtoId = req.params.id;
    const usuario_id = req.session.usuario?.id;
    const prefersJson = req.get('X-Requested-With') === 'fetch';

    if (!usuario_id) {
      const msg = 'Sessão inválida.';
      return prefersJson ? res.status(401).json({ error: msg }) : res.status(401).send(msg);
    }

    // 1) Busca produto e valida dono
    const { data: produtoExistente, error: fetchErr } = await supabaseDb
      .from('produtos')
      .select('*')
      .eq('id', produtoId)
      .single();

    if (fetchErr || !produtoExistente) {
      const msg = 'Produto não encontrado.';
      return prefersJson ? res.status(404).json({ error: msg }) : res.status(404).send(msg);
    }
    if (produtoExistente.usuario_id !== usuario_id) {
      const msg = 'Acesso negado.';
      return prefersJson ? res.status(403).json({ error: msg }) : res.status(403).send(msg);
    }

    // 2) Extrai body
    const {
      nome, descricao, preco, marca, tipo, categoria, condicao,
      ano_fabricacao, captadores_config, madeira, tags,
      pais_fabricacao, cor, cor_personalizada, acabamento, cordas, shape,
      quantidade // <- novo
    } = req.body;

    // 3) Monta payload com validações
    const updatePayload = {
      // Strings: usa trim quando faz sentido
      nome: nome?.trim(),
      descricao,
      marca: marca ?? produtoExistente.marca,
      tipo: tipo ?? produtoExistente.tipo,
      categoria: categoria ?? produtoExistente.categoria,
      condicao: condicao ?? produtoExistente.condicao,
      captadores_config: captadores_config ?? produtoExistente.captadores_config,
      madeira: madeira ?? produtoExistente.madeira,
      tags: (typeof tags === 'string' ? tags : produtoExistente.tags),
      pais_fabricacao: pais_fabricacao ?? produtoExistente.pais_fabricacao,
      acabamento: acabamento ?? produtoExistente.acabamento,
      shape: shape ?? produtoExistente.shape,

      // Numéricos
      ano_fabricacao: ano_fabricacao ? parseInt(ano_fabricacao, 10) : null,
      cordas: cordas ? parseInt(cordas, 10) : null
    };

    // 3.1) Cor final (suporta “Outra cor…”)
    if (typeof cor === 'string') {
      updatePayload.cor = (cor === '__outro__')
        ? (cor_personalizada?.trim() || null)
        : cor;
    }

    // 3.2) Preço (só se veio algo)
    if (typeof preco === 'string' && preco.trim() !== '') {
      const n = parsePrecoFlex(preco); // sua função util
      if (n == null || n < 0) {
        const msg = 'Preço inválido.';
        return prefersJson ? res.status(400).json({ error: msg }) : res.status(400).send(msg);
      }
      updatePayload.preco = Math.round(n * 100) / 100; // NUMERIC(10,2)
      // Se usar centavos (INTEGER), troque por toCentavos(n)
    }

    // 3.3) Quantidade (só se veio no form)
    if (typeof quantidade !== 'undefined') {
      const q = parseInt(quantidade, 10);
      if (Number.isNaN(q) || q < 0) {
        const msg = 'Quantidade inválida. Deve ser maior ou igual a 0.';
        return prefersJson ? res.status(400).json({ error: msg }) : res.status(400).send(msg);
      }
      updatePayload.quantidade = q;
    }

    // Remove chaves undefined (evita sobrescrever com undefined)
    Object.keys(updatePayload).forEach(k => {
      if (updatePayload[k] === undefined) delete updatePayload[k];
    });

    // 4) Update
    const { error: updateError } = await supabaseDb
      .from('produtos')
      .update(updatePayload)
      .eq('id', produtoId);

    if (updateError) {
      console.error('Erro ao atualizar produto:', updateError);
      const msg = 'Erro ao atualizar produto.';
      return prefersJson ? res.status(500).json({ error: msg }) : res.status(500).send(msg);
    }

    // 5) OK
    const redirectUrl = '/painel/usuario'; // ajuste para /painel/loja se for PJ
    return prefersJson
      ? res.status(200).json({ ok: true, id: produtoId, redirect: redirectUrl })
      : res.redirect(redirectUrl);

  } catch (e) {
    console.error('Erro inesperado no update:', e);
    const msg = 'Erro interno ao salvar.';
    return res.status(500).send(msg);
  }
});



router.post('/produto/:id/excluir', requireLogin, async (req, res) => {
  const { id } = req.params;
  const usuario_id = req.session.usuario?.id;

  // Busca o produto no banco
  const { data: produto, error } = await supabaseDb
    .from('produtos')
    .select('usuario_id')
    .eq('id', id)
    .maybeSingle();

  if (error || !produto) {
    console.error('Produto não encontrado:', error);
    return res.status(404).send('Produto não encontrado.');
  }

  if (produto.usuario_id !== usuario_id) {
    return res.status(403).send('Acesso negado.');
  }

  const { data: deleteData, error: deleteError } = await supabaseDb
    .from('produtos')
    .delete()
    .eq('id', id)
    .select(); // <-- Adicione isso para forçar o retorno

  if (deleteError) {
    console.error('Erro ao excluir produto:', deleteError);
    return res.status(500).send('Erro ao excluir produto.');
  }

//console.log('Produto excluído:', deleteData);


//console.log('ID recebido:', id);
//console.log('Produto encontrado:', produto);
//console.log('Usuário logado:', usuario_id);

  if (req.session.usuario.tipo === 'pj') {
  return res.redirect('/painel/loja');
} else {
  return res.redirect('/painel/usuario');
}

});

// PROTEGER a rota
router.post('/comprar/:id', requireLogin, async (req, res) => {
  const compradorId = req.session.usuario.id;
  const tipoComprador = req.session.usuario.tipo; // 'pf' | 'pj'
  const produtoId = req.params.id;
  const quantidade = 1;

  // Buscar produto (preço/estoque/dono)
  const { data: produto, error: produtoError } = await supabaseDb
    .from('produtos')
    .select('id, usuario_id, tipo_usuario, preco, quantidade')
    .eq('id', produtoId)
    .maybeSingle();

  if (produtoError || !produto) {
    console.error(produtoError);
    return res.status(404).send('Produto não encontrado');
  }

  if (produto.quantidade == null || produto.quantidade < quantidade) {
    return res.status(400).send('Produto sem estoque suficiente');
  }

  try {
    // Usa o helper para respeitar o schema de pedidos do projeto
    const pedido = await criarPedido({
      compradorIdPF: tipoComprador === 'pf' ? compradorId : null,
      compradorIdPJ: tipoComprador === 'pj' ? compradorId : null,
      produtoId,
      qtd: quantidade,
      precoTotal: (produto.preco || 0) * quantidade
    });

    // (Opcional) decrementar estoque
    const { error: decErr } = await supabaseDb.rpc('decrementa_estoque', {
      p_id: produtoId,
      p_qtd: quantidade
    });
    if (decErr) console.error('Erro ao decrementar estoque:', decErr);

    return res.redirect('/meus-pedidos');
  } catch (e) {
    console.error('Erro ao criar pedido:', e);
    return res.status(500).send('Erro ao processar pedido');
  }
});




module.exports = router;
