const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const { requireLogin } = require('../middlewares/auth'); // ✅ CORRETO

// GET: Página de perfil de Pessoa Física
router.get('/perfil', requireLogin, async (req, res) => {
  const usuarioId = req.session.usuario?.id;
  const tipo = req.session.usuario?.tipo;

  if (!usuarioId || tipo !== 'pf') {
    return res.redirect('/login');
  }

  const { data: usuario, error } = await supabase
    .from('usuarios_pf')
    .select('*')
    .eq('id', usuarioId)
    .single();

  if (error || !usuario) {
    console.error('Erro ao buscar dados do perfil:', error);
    return res.status(500).send('Erro ao carregar perfil.');
  }

  res.render('perfil', { usuario });
});

router.get('/painel/usuario', requireLogin, async (req, res) => {
  const usuarioId = req.session.usuario.id;

  const { data: produtos, error } = await supabase
    .from('produtos')
    .select('*')
    .eq('usuario_id', usuarioId);

  if (error) {
    console.error('Erro ao buscar produtos:', error);
    return res.status(500).send('Erro ao carregar seus produtos.');
  }

  res.render('painel-usuario', { usuario: req.session.usuario, produtos });
});

router.get('/painel/editar-usuario', requireLogin, async (req, res) => {
  const usuario = req.session.usuario;
  res.render('editar-usuario', { usuario });
});

router.post('/painel/editar-usuario', requireLogin, async (req, res) => {
  const { nome, telefone, icone_url } = req.body;
  const usuarioId = req.session.usuario.id;

  const { error } = await supabase
    .from('usuarios_pf')
    .update({ nome, telefone, icone_url })
    .eq('id', usuarioId);

  if (error) {
    console.error('Erro ao atualizar usuário:', error);
    return res.status(500).send('Erro ao atualizar perfil.');
  }

  // Atualiza a sessão local para refletir mudanças
  req.session.usuario.nome = nome;
  req.session.usuario.telefone = telefone;
  req.session.usuario.icone_url = icone_url;

  res.redirect('/painel/usuario');
});

router.get('/usuario/:id', async (req, res) => {
  const usuarioId = req.params.id;

  const { data: usuario, error: usuarioError } = await supabase
    .from('usuarios_pf')
    .select('*')
    .eq('id', usuarioId)
    .single();

  if (usuarioError || !usuario) {
    console.error(usuarioError);
    return res.status(404).send('Usuário não encontrado.');
  }

  const { data: produtos, error: produtosError } = await supabase
    .from('produtos')
    .select('*')
    .eq('usuario_id', usuarioId)
    .eq('tipo_usuario', 'pf');

  if (produtosError) {
    console.error(produtosError);
    return res.status(500).send('Erro ao buscar produtos do usuário.');
  }

  res.render('usuario-publico', { usuario, produtos });
});



module.exports = router;
