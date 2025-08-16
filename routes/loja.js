const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const { requireLogin,requirePJ } = require('../middlewares/auth'); 
//listagem de lojas
router.get('/lojas', async (req, res) => {
  const { data: lojas, error } = await supabase.from('usuarios_pj').select('*');

  if (error) {
    console.error('Erro ao buscar lojas:', error);
    return res.status(500).send('Erro ao carregar lojas');
  }

  res.render('listings-lojas', { lojas, query: req.query });
});


// GET: Página da loja
router.get('/loja/:id', async (req, res) => {
  const lojaId = req.params.id;
  const {
    marca = '',
    tipo = '',
    preco_min = 0,
    preco_max = 10000
  } = req.query;

  // Busca produtos da loja
  let query = supabase
    .from('produtos')
    .select('*')
    .eq('usuario_id', lojaId)
    .gte('preco', preco_min)
    .lte('preco', preco_max);

  if (marca) {
    query = query.ilike('marca', `%${marca}%`);
  }

  if (tipo) {
    query = query.ilike('tipo', `%${tipo}%`);
  }

  const { data: produtos, error: prodError } = await query;

  // Busca dados da loja
  const { data: loja, error: lojaError } = await supabase
    .from('usuarios_pj')
    .select('id, nomeFantasia, cidade, estado, telefone, icone_url, nota')
    .eq('id', lojaId)
    .single();

  if (prodError || lojaError || !loja) {
    console.error(prodError || lojaError);
    return res.status(500).send('Erro ao buscar loja ou produtos');
  }

  res.render('loja', {
    loja,
    produtos,
    marca,
    tipo,
    preco_min,
    preco_max
  });
});

// POST: Compra de um item
router.post('/comprar/:id', requireLogin,  async (req, res) => {
  const itemId = req.params.id;

  // Aqui você pode adicionar lógica real de compra:
  // - inserir em tabela de pedidos
  // - registrar usuário comprador
  // - decrementar estoque, etc

  res.send(`Compra registrada para o produto ${itemId}`);
});

router.get('/painel/loja', requireLogin,requirePJ, async (req, res) => {
  const usuario = req.session.usuario;

  if (usuario.tipo !== 'pj') {
    return res.status(403).send('Acesso restrito a lojas');
  }

  const { data: loja, error } = await supabase
    .from('usuarios_pj')
    .select('*')
    .eq('id', usuario.id)
    .single();

  if (error) {
    console.error('Erro ao carregar painel da loja:', error);
    return res.status(500).send('Erro ao carregar painel');
  }

  const { data: produtos, error: prodError } = await supabase
    .from('produtos')
    .select('*')
    .eq('usuario_id', usuario.id);

  res.render('painel-loja', { loja, produtos });
});


router.get('/painel/editar-loja', requireLogin, requirePJ, async (req, res) => {
  const usuario = req.session.usuario;

  if (usuario.tipo !== 'pj') {
    return res.status(403).send('Acesso restrito a lojas');
  }

  const { data: loja, error } = await supabase
    .from('usuarios_pj')
    .select('*')
    .eq('id', usuario.id)
    .single();

  if (error) {
    console.error('Erro ao buscar dados da loja:', error);
    return res.status(500).send('Erro ao carregar edição da loja');
  }

  res.render('editar-loja', { loja });
});

const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: 'public/uploads/icones/',
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}${ext}`);
  }
});

const upload = multer({ storage });

router.post('/painel/editar-loja', upload.single('icone'), async (req, res) => {
  console.log('Imagem recebida:', req.file); // ← Aqui

  const { nomeFantasia, telefone, estado, cidade, endereco, descricao } = req.body;

  const icone_url = req.file ? `/uploads/icones/${req.file.filename}` : undefined;

  const updates = {
    nomeFantasia,
    telefone,
    estado,
    cidade,
    endereco,
    descricao
  };

  if (icone_url) updates.icone_url = icone_url;

  const { error } = await supabase
    .from('usuarios_pj')
    .update(updates)
    .eq('id', req.session.usuario.id);

  if (error) {
    console.error(error);
    return res.status(500).send('Erro ao atualizar loja');
  }

  if (icone_url) {
    req.session.usuario.icone_url = icone_url;
  }

  res.redirect('/painel/loja');
});

module.exports = router;
