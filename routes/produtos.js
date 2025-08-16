
const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const { requireLogin } = require('../middlewares/auth');
const upload = require('../middlewares/upload');
const { parsePrecoFlex, toCentavos } = require('../utils/preco'); 
const { normalizeSimple } = require('../utils/normalizeText'); 
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

  let query = supabase.from('produtos').select('*');

  // Preço: aplique apenas quando vier número válido
  const min = parseFloat(preco_min);
  if (!isNaN(min) && min > 0) query = query.gte('preco', min);

  // Ajuste o default (1.000.000) para bater com seu EJS
  const max = parseFloat(preco_max);
  if (!isNaN(max) && max < 1_000_000) query = query.lte('preco', max);

  // Filtros simples
  if (condicao && condicao.trim())    query = query.eq('condicao', condicao);
  if (acabamento && acabamento.trim())query = query.eq('acabamento', acabamento);
  if (cor && cor.trim())              query = query.ilike('cor', cor);
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

    // 1) verifica se existe (ou já pode buscar tudo e depois incrementar)
    const { data: item, error } = await supabase
      .from('produtos')
      .select('id, nome, preco, imagem_url, descricao, condicao, marca, shape, modelo, cor, madeira, acabamento, pais_fabricacao, ano_fabricacao, captadores_config, cordas,tipo_usuario, usuario_id, acessos, nota, created_at')
      .eq('id', id)
      .single();

    if (error || !item) {
      console.error('Erro ao buscar item:', error);
      return res.status(404).send('Produto não encontrado');
    }

    if (item.created_at) {
    const dataCriacao = new Date(item.created_at);
    const hoje = new Date();
    const diffMs = hoje - dataCriacao; // diferença em milissegundos
    const diffDias = Math.floor(diffMs / (1000 * 60 * 60 * 24)); // converte para dias
    item.dias_listado = diffDias;
  }
  
    // 2) incrementa acessos de forma atômica
    const { error: incErr } = await supabase.rpc('increment_acessos', { p_id: id });
    if (incErr) console.error('Erro ao incrementar acessos:', incErr);

    // 3) busca dono
    let dono = null;
    if (item.tipo_usuario === 'pj') {
      const { data, error: erroPJ } = await supabase
        .from('usuarios_pj')
        .select('id, nomeFantasia, nota, icone_url, descricao, itens_vendidos, cidade, estado, created_at')
        .eq('id', item.usuario_id)
        .single();
      dono = data;
      if (erroPJ) console.error('Erro ao buscar loja:', erroPJ);
    } else {
      const { data, error: erroPF } = await supabase
        .from('usuarios_pf')
        .select('id, nome, icone_url, nota, itens_vendidos')
        .eq('id', item.usuario_id)
        .single();
      dono = data;
      if (erroPF) console.error('Erro ao buscar usuário PF:', erroPF);
    }

    const { voltar } = req.query;
    res.render('item', { item, dono, voltar });
  } catch (err) {
    console.error('Erro inesperado:', err);
    res.status(500).send('Erro no servidor');
  }
});

// Cadastro de novo item com imagens
// helper: decide se a rota deve responder JSON (sem navegação)
function wantsJson(req) {
  return req.headers['x-requested-with'] === 'fetch' ||
         req.headers['x-requested-with'] === 'XMLHttpRequest' ||
         (req.headers.accept || '').includes('application/json') ||
         req.xhr === true;
}

router.post('/cadastro-item', requireLogin, upload.array('imagens', 12), async (req, res) => {
  try {
    const usuario_id = req.session.usuario?.id;
    const tipo_usuario = req.session.usuario?.tipo;
    const files = req.files;

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

      const { error: uploadError } = await supabase
        .storage
        .from('imagens')
        .upload(filename, file.buffer, { contentType: file.mimetype });

      if (uploadError) {
        console.error('Upload error:', uploadError);
        if (wantsJson(req)) return res.status(500).json({ error: 'Erro ao fazer upload de imagem.' });
        return res.status(500).send('Erro ao fazer upload de imagem.');
      }

      const { data: publicUrlData } = supabase.storage.from('imagens').getPublicUrl(filename);
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

    // Shape final: hidden selecionado OU texto manual
    const shapeFinal = (shape && shape.trim()) || (outro_tipo && outro_tipo.trim()) || null;

    // Modelo final
    const modeloFinal = (modelo === '__outro__')
      ? ((modelo_outro || '').trim() || null)
      : ((modelo || '').trim() || null);

    // Preço (pt-BR -> número)
    const precoFinal = (() => {
    const n = parsePrecoFlex(preco); // -> Number(1234.56) ou null
    if (n == null || n < 0) return null; // validação simples
    return Math.round(n * 100) / 100;     // garante 2 casas
  })();
    console.log('req.body.quantidade =', req.body?.quantidade);
    console.log('quantidade (parsed) =', quantidade);

    // Inserção no banco
    const { data: inserted, error: dbError } = await supabase.from('produtos').insert([{
      nome: nome?.trim(),
      descricao,
      preco: precoFinal,
      marca: marcaFinal,
      tipo: tipo || null,
      categoria: categoria || null,
      condicao: condicao || null,
      imagem_url: imagemUrls.join(','), // CSV de URLs
      usuario_id,
      tipo_usuario, // PF/PJ
      ano_fabricacao: ano_fabricacao ? parseInt(ano_fabricacao) : null,
      captadores_config: captadores_config || null,
      madeira: madeira || null,
      tags: tags || null, // se vier "a,b,c" mantenho string (ajuste se usar array)
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

        await supabase.from('catalogo_modelos').upsert(
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

  const { data: produto, error } = await supabase
    .from('produtos')
    .select('*')
    .eq('id', produtoId)
    .single();

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
    const { data: produtoExistente, error: fetchErr } = await supabase
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
    const { error: updateError } = await supabase
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
  const { data: produto, error } = await supabase
    .from('produtos')
    .select('usuario_id')
    .eq('id', id)
    .single();

  if (error || !produto) {
    console.error('Produto não encontrado:', error);
    return res.status(404).send('Produto não encontrado.');
  }

  if (produto.usuario_id !== usuario_id) {
    return res.status(403).send('Acesso negado.');
  }

  const { data: deleteData, error: deleteError } = await supabase
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

router.post('/comprar/:id', async (req, res) => {
  const compradorId = req.session.usuario.id;
  const produtoId = req.params.id;
  const quantidade = 1; // ajuste se quiser múltiplas quantidades

  // 🟠 Buscar vendedor_id do produto
  const { data: produto, error: produtoError } = await supabase
    .from('produtos')
    .select('usuario_id, preco')
    .eq('id', produtoId)
    .single();

  if (produtoError || !produto) {
    console.error(produtoError);
    return res.status(500).send('Erro ao buscar produto');
  }

  const vendedorId = produto.usuario_id;

  // 🟢 Buscar preco_total do req.body ou produto
  let precoTotal = req.body.preco_total;

  if (!precoTotal) {
    precoTotal = produto.preco; // usa o preco do produto como fallback
  }

  // 📝 Inserir pedido
  const { data, error } = await supabase
    .from('pedidos')
    .insert([{
      usuario_id: compradorId,
      produto_id: produtoId,
      vendedor_id: vendedorId,
      quantidade,
      preco_total: precoTotal,
      status: 'Em processamento',
      data_pedido: new Date()
    }]);

  if (error) {
    console.error(error);
    return res.status(500).send('Erro ao processar pedido');
  }

  res.redirect('/meus-pedidos');
});



module.exports = router;
