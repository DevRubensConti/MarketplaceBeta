const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const bcrypt = require('bcrypt');


// Página de login
router.get('/login', (req, res) => {
  res.render('login');
});

// Login - PF ou PJ
router.post('/login', async (req, res) => {
  const { email, senha } = req.body;

  // 1. Autentica via Supabase Auth
  const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
    email,
    password: senha
  });

  if (loginError || !loginData?.user) {
    console.error('Erro ao logar no Supabase Auth:', loginError);
    return res.status(401).render('login', {
      erroLogin: 'E-mail ou senha inválidos.'
    });
  }

  const uid = loginData.user.id;

  // 2. Busca dados do usuário PF
  const { data: pf } = await supabase
    .from('usuarios_pf')
    .select('*')
    .eq('id', uid)
    .single();

  // 3. Se não for PF, tenta PJ
  let usuario = pf;
  let tipo = 'pf';

  if (!usuario) {
    const { data: pj } = await supabase
      .from('usuarios_pj')
      .select('*')
      .eq('id', uid)
      .single();

    if (!pj) {
      return res.status(401).render('login', {
        erroLogin: 'Usuário não encontrado.'
      });
    }

    usuario = pj;
    tipo = 'pj';
  }

  // 4. Salva dados na sessão
  req.session.usuario = {
    id: uid, // 👈 UID real do Supabase Auth
    nome: usuario.nome || usuario.nomeFantasia,
    tipo,
    email: usuario.email,
    telefone: usuario.telefone,
    icone_url: usuario.icone_url || '/images/user_default.png'
  };

  res.redirect('/');
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
//Cadastro PJ
router.post('/cadastro-pj', async (req, res) => {
  const {
    nomeFantasia, razaoSocial, cnpj, email, senha, telefone,
    cep, estado, endereco, numero, bairro, complemento, icone_url
  } = req.body;

  try {
    // 1. Verifica se e-mail já existe em PF ou PJ
    const { data: existePF } = await supabase.from('usuarios_pf').select('id').eq('email', email).single();
    const { data: existePJ } = await supabase.from('usuarios_pj').select('id').eq('email', email).single();

    if (existePF || existePJ) {
      return res.render('cadastro-pj', { mensagemErro: 'Já existe uma conta com esse e-mail.' });
    }

    // 2. Verifica se CNPJ já está cadastrado
    const { data: cnpjExistente } = await supabase.from('usuarios_pj').select('id').eq('cnpj', cnpj).single();

    if (cnpjExistente) {
      return res.render('cadastro-pj', { mensagemErro: 'Já existe uma loja com esse CNPJ.' });
    }

    // 3. Cria o usuário no Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password: senha
    });

    if (authError || !authData?.user) {
      console.error('Erro ao criar usuário no Auth:', authError);
      return res.render('cadastro-pj', { mensagemErro: 'Erro ao registrar no sistema de autenticação.' });
    }

    const uid = authData.user.id;

    // 4. Prepara os dados da loja
    const loja = {
      id: uid, // 👈 UID do Supabase Auth
      nomeFantasia,
      razaoSocial,
      cnpj,
      email,
      telefone,
      cep,
      estado,
      endereco,
      numero,
      bairro,
      complemento
    };

    if (icone_url && icone_url.trim() !== '') {
      loja.icone_url = icone_url;
    }

    // 5. Insere na tabela usuarios_pj
    const { error: insertError } = await supabase.from('usuarios_pj').insert([loja]);

    if (insertError) {
      console.error('Erro ao cadastrar loja:', insertError);
      return res.status(500).send('Erro ao cadastrar loja');
    }

    res.redirect('/login');
  } catch (err) {
    console.error('Erro ao processar cadastro:', err);
    res.status(500).send('Erro interno ao processar o cadastro');
  }
});



router.post('/cadastro-pf', async (req, res) => {
  try {
    const {
      nome, sobrenome, cpf, data_nascimento,
      email, senha, telefone,
      cep, estado, endereco, numero, bairro, complemento
    } = req.body;

    // 1. Verifica se e-mail já existe em PF ou PJ
    const { data: existePF } = await supabase.from('usuarios_pf').select('id').eq('email', email).single();
    const { data: existePJ } = await supabase.from('usuarios_pj').select('id').eq('email', email).single();

    if (existePF || existePJ) {
      return res.render('cadastro-pf', { mensagemErro: 'Já existe uma conta com esse e-mail.' });
    }

    // 2. Verifica se CPF já está cadastrado
    const { data: cpfExistente } = await supabase.from('usuarios_pf').select('id').eq('cpf', cpf).single();

    if (cpfExistente) {
      return res.render('cadastro-pf', { mensagemErro: 'Já existe uma conta com esse CPF.' });
    }

    // 3. Cria o usuário no Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password: senha
    });

    if (authError || !authData?.user) {
      console.error('Erro ao criar usuário no Auth:', authError);
      return res.render('cadastro-pf', { mensagemErro: 'Erro ao registrar no sistema de autenticação.' });
    }

    const uid = authData.user.id;

    // 4. Salva dados complementares na tabela usuarios_pf (usando o UID como id)
    const { error: dbError } = await supabase.from('usuarios_pf').insert([{
      id: uid, // 👈 Relacionado ao auth.uid()
      nome,
      sobrenome,
      cpf,
      data_nascimento,
      email,
      telefone,
      cep,
      estado,
      endereco,
      numero,
      bairro,
      complemento
    }]);

    if (dbError) {
      console.error('Erro ao inserir no usuarios_pf:', dbError);
      return res.status(500).send('Erro ao salvar os dados do usuário.');
    }

    res.redirect('/plano-assinatura');
  } catch (err) {
    console.error('Erro interno:', err);
    res.status(500).send('Erro interno ao processar cadastro');
  }
});

// Página de cadastro
router.get('/signup', (req, res) => {
  res.render('signup');
});

// Página de escolha de cadastro
router.get('/escolher-cadastro', (req, res) => {
  res.render('escolher-cadastro');
});

router.get('/cadastro-pf', (req, res) => {
  res.render('cadastro-pf', { mensagemErro: null });
});

router.get('/cadastro-pj', (req, res) => {
  res.render('cadastro-pj', { mensagemErro: null });
});

module.exports = router;

