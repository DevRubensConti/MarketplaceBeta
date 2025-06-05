const express = require('express');
const router = express.Router();
const supabase = require('../supabase');

// Página de login
router.get('/login', (req, res) => {
  res.render('login');
});

// Login - PF ou PJ
router.post('/login', async (req, res) => {
  const { email, senha } = req.body;

  // Verifica PF
  const { data: pf, error: errorPF } = await supabase
    .from('usuarios_pf')
    .select('*')
    .eq('email', email)
    .eq('senha', senha)
    .single();

  // Verifica PJ se não for PF
  let pj = null;
  if (!pf) {
    const { data } = await supabase
      .from('usuarios_pj')
      .select('*')
      .eq('email', email)
      .eq('senha', senha)
      .single();
    pj = data;
  }

  if (pf) {
    req.session.usuario = {
      id: pf.id,
      nome: pf.nome,
      tipo: 'pf',
      icone_url: pf.icone_url || '/images/user_default.png',
      email: pf.email,
      telefone: pf.telefone
    };
    return res.redirect('/');
  }

  if (pj) {
    req.session.usuario = {
      id: pj.id,
      nome: pj.nomeFantasia || pj.nome,
      tipo: 'pj',
      icone_url: pj.icone_url || '/images/store_logos/store.png',
      email: pj.email,
      telefone: pj.telefone
    };
    return res.redirect('/');
  }

  return res.status(401).send('Email ou senha inválidos.');
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Erro ao fazer logout:', err);
      return res.status(500).send('Erro ao fazer logout.');
    }
    res.redirect('/');
  });
});

// Cadastro PJ
router.post('/cadastro-loja', async (req, res) => {
  const {
    nomeFantasia, razaoSocial, cnpj, email, senha, telefone,
    cep, estado, endereco, numero, bairro, complemento, icone_url
  } = req.body;

  const loja = {
    nomeFantasia, razaoSocial, cnpj, email, senha, telefone,
    cep, estado, endereco, numero, bairro, complemento
  };

  if (icone_url && icone_url.trim() !== '') {
    loja.icone_url = icone_url;
  }

  const { error } = await supabase.from('usuarios_pj').insert([loja]);

  if (error) {
    console.error('Erro ao cadastrar loja:', error);
    return res.status(500).send('Erro ao cadastrar loja');
  }

  res.redirect('/login');
});

// Cadastro PF
router.post('/cadastro-pf', async (req, res) => {
  const { error } = await supabase.from('usuarios_pf').insert([req.body]);

  if (error) {
    console.error(error);
    return res.status(500).send('Erro ao cadastrar pessoa física');
  }

  res.redirect('/plano-assinatura');
});

// Página de cadastro
router.get('/signup', (req, res) => {
  res.render('signup');
});

module.exports = router;
