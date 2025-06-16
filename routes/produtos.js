const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const { requireLogin } = require('../middlewares/auth');
const upload = require('../middlewares/upload');
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
    const { preco_min, preco_max, marca, tipo, categoria, condicao, pesquisa, modelo, acabamento } = req.query;

    let query = supabase.from('produtos').select('*');

    if (preco_min && preco_min !== '0' && !isNaN(preco_min)) query = query.gte('preco', parseFloat(preco_min));
    if (preco_max && preco_max !== '100000' && !isNaN(preco_max)) query = query.lte('preco', parseFloat(preco_max));
    if (condicao && condicao.trim()) query = query.eq('condicao', condicao);
    if (marca) query = query.in('marca', Array.isArray(marca) ? marca : [marca]);
    if (tipo) query = query.in('tipo', Array.isArray(tipo) ? tipo : [tipo]);
    if (categoria) query = query.in('categoria', Array.isArray(categoria) ? categoria : [categoria]);
    if (modelo) query = query.in('modelo', (Array.isArray(modelo) ? modelo : [modelo]).map(m => m.trim()));
    if (acabamento && acabamento.trim()) query = query.eq('acabamento', acabamento);
    if (pesquisa && pesquisa.trim()) {
    const termo = `%${pesquisa}%`;
    query = query.or(`nome.ilike.${termo},descricao.ilike.${termo},tags.ilike.${termo},modelo.ilike.${termo},cor.ilike.${termo}`);
    }

  const { data: produtos, error } = await query;

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

    const { data: item, error } = await supabase
      .from('produtos')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !item) {
      console.error('Erro ao buscar item:', error);
      return res.status(404).send('Produto não encontrado');
    }

    let dono = null;

    if (item.tipo_usuario === 'pj') {
      const { data, error: erroPJ } = await supabase
        .from('usuarios_pj')
        .select('id, nomeFantasia, nota, icone_url')
        .eq('id', item.usuario_id)
        .single();
      dono = data;
      if (erroPJ) console.error('Erro ao buscar loja:', erroPJ);
    } else {
      const { data, error: erroPF } = await supabase
        .from('usuarios_pf')
        .select('id, nome, icone_url')
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
router.post('/cadastro-item', requireLogin, upload.array('imagens', 12), async (req, res) => {
  const usuario_id = req.session.usuario?.id;
  const tipo_usuario = req.session.usuario?.tipo;
  const files = req.files;

  if (!files || files.length === 0) {
    return res.status(400).send('Pelo menos uma imagem é obrigatória.');
  }

  const imagemUrls = [];

  for (const file of files) {
    const filename = `${Date.now()}_${file.originalname}`;

    const { error: uploadError } = await supabase
      .storage
      .from('imagens')
      .upload(filename, file.buffer, { contentType: file.mimetype });

    if (uploadError) {
      console.error(uploadError);
      return res.status(500).send('Erro ao fazer upload de imagem.');
    }

    const { data: publicUrlData } = supabase
      .storage
      .from('imagens')
      .getPublicUrl(filename);

    imagemUrls.push(publicUrlData.publicUrl);
  }

  const {
    nome, descricao, preco, marca, marca_personalizada, tipo, condicao,
    tags, ano_fabricacao, cor, captadores_config, madeira,
    pais_fabricacao, cordas, categoria, modelo, acabamento
  } = req.body;

  const marcaFinal = marca === 'Outra...' ? marca_personalizada : marca;

 const precoLimpo = preco.replace(',', '.');
 const precoFinal = precoLimpo ? Number(parseFloat(precoLimpo).toFixed(2)) : null;


  const { error: dbError } = await supabase.from('produtos').insert([{
    nome,
    descricao,
    preco: precoFinal,
    marca: marcaFinal,
    tipo: tipo || null,
    categoria: categoria || null,
    condicao: condicao || null,
    imagem_url: imagemUrls.join(','),
    usuario_id,
    tipo_usuario, // necessário para saber se é PF ou PJ
    ano_fabricacao: ano_fabricacao ? parseInt(ano_fabricacao) : null,
    captadores_config,
    madeira,
    tags,
    pais_fabricacao,
    cor,
    acabamento,
    cordas: cordas ? parseInt(cordas) : null,
    modelo
  }]);

  if (dbError) {
    console.error('Erro ao cadastrar produto:', dbError);
    return res.status(500).send('Erro ao cadastrar item.');
  }

  // Redireciona para o painel correto com base no tipo de usuário
  if (tipo_usuario === 'pj') {
    return res.redirect('/painel/loja');
  } else {
    return res.redirect('/painel/usuario');
  }
});



// Geração de descrição com IA
router.post('/gerar-descricao', async (req, res) => {
  const { nome, modelo, marca, tipo, categoria } = req.body;

  const prompt = `Gere uma descrição envolvente e profissional para um produto musical com as seguintes características:
  Nome: ${nome}
  Modelo: ${modelo}
  Marca: ${marca}
  Tipo de Instrumento: ${tipo}
  Categoria: ${categoria}`;

  try {
    const openaiResponse = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }]
    });

    const descricao = openaiResponse.choices[0].message.content;
    res.json({ descricao });
  } catch (error) {
    console.error('Erro ao gerar descrição:', error);
    res.status(500).send('Erro ao gerar descrição automática.');
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
  const produtoId = req.params.id;
  const usuario_id = req.session.usuario.id;

  const { data: produtoExistente, error } = await supabase
    .from('produtos')
    .select('*')
    .eq('id', produtoId)
    .single();

  if (error || !produtoExistente) {
    return res.status(404).send('Produto não encontrado.');
  }

  if (produtoExistente.usuario_id !== usuario_id) {
    return res.status(403).send('Acesso negado.');
  }

  const {
    nome, descricao, preco, marca, tipo, categoria, condicao,
    ano_fabricacao, captadores_config, madeira, tags,
    pais_fabricacao, cor, acabamento, cordas, modelo
  } = req.body;

  const precoLimpo = preco.replace(',', '.');
  const precoFinal = precoLimpo ? Number(parseFloat(precoLimpo).toFixed(2)) : null;

  const { error: updateError } = await supabase
    .from('produtos')
    .update({
      nome,
      descricao,
      preco: precoFinal,
      marca,
      tipo,
      categoria,
      condicao,
      ano_fabricacao: ano_fabricacao ? parseInt(ano_fabricacao) : null,
      captadores_config,
      madeira,
      tags,
      pais_fabricacao,
      cor,
      acabamento,
      cordas: cordas ? parseInt(cordas) : null,
      modelo
    })
    .eq('id', produtoId);

  if (updateError) {
    console.error(updateError);
    return res.status(500).send('Erro ao atualizar produto.');
  }

  res.redirect('/painel/usuario'); // ou /painel/loja se for PJ
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



module.exports = router;
