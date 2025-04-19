const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const PORT = 3000;
const multer = require('multer');
const path = require('path');
const supabase = require('./supabase');

// Configura multer
const storage = multer.memoryStorage();
const upload = multer({ storage });



app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Configurações
app.set('view engine', 'ejs');
app.set('views', './views');
app.use(express.static('public'));

// Banco de dados fake
const usuarios = {
  lojas: [],
  pessoasFisicas: []
};


// Rotas
app.get('/', (req, res) => {
res.render('index', { titulo: 'Pagina Inicial' });
});
app.get('/signup', (req, res) => {
  res.render('signup');
});
app.get('/login', (req, res) => {
  res.render('login'); 
});
app.get('/listings', (req, res) => {
  res.render('listings'); 
});
app.get('/item', (req, res) => {
  res.render('item'); 
});
app.get('/cadastro-item', (req, res) => {
  res.render('cadastro-item'); 
});
app.get('/produtos', async (req, res) => {
  const { data: produtos, error } = await supabase
    .from('produtos')
    .select('*');
    console.log('Produtos encontrados:', produtos);

  if (error) {
    console.error(error);
    return res.status(500).send('Erro ao buscar produtos');
  }

  res.render('listings', { produtos });
});


// Cadastro de Loja
app.post('/cadastro-loja', async(req, res) => {
  const {data, error} = await supabase
    .from('usuarios_pj')
    .insert([req.body]);

  if (error){
    console.error(error);
    return res.status(500).send('Erro ao cadastrar pessoa fisica')
  }
});

// Cadastro de Pessoa Física
app.post('/cadastro-pf', async(req, res) => {
  const {data, error} = await supabase
    .from('usuarios_pf')
    .insert([req.body]);

  if (error){
    console.error(error);
    return res.status(500).send('Erro ao cadastrar pessoa fisica')
  }

  res.send('Cadastro feito com sucesso!');
});

app.post('/login', async (req, res) => {
  const { email, senha } = req.body;

  // Buscar em PF
  const { data: pf, error: errorPF } = await supabase
    .from('usuarios_pf')
    .select('*')
    .eq('email', email)
    .eq('senha', senha)
    .single();

  let pj = null;
  let errorPJ = null;

  // Buscar em PJ apenas se não encontrou na PF
  if (!pf) {
    const result = await supabase
      .from('usuarios_pj')
      .select('*')
      .eq('email', email)
      .eq('senha', senha)
      .single();

    pj = result.data;
    errorPJ = result.error;
  }

  if (pj) {
    return res.send(`Login PJ OK! Bem-vindo(a), ${pj.nome_fantasia || pj.nome}`);
  }

  if (pf) {
    return res.send(`Login PF OK! Bem-vindo(a), ${pf.nome}`);
  }

  return res.send('Email ou senha inválidos.');
});

// Cadastro de item com imagem
app.post('/cadastro-item', upload.single('imagem'), async (req, res) => {
  const { nome, preco, descricao, marca, tipo, condicao } = req.body;
  const file = req.file;

  if (!file) return res.status(400).send('Imagem é obrigatória.');

  const filename = `${Date.now()}_${file.originalname}`;
  const { error: uploadError } = await supabase
    .storage
    .from('imagens')
    .upload(filename, file.buffer, {
      contentType: file.mimetype
    });

  if (uploadError) {
    console.error(uploadError);
    return res.status(500).send('Erro ao fazer upload da imagem.');
  }

  const { data: publicUrlData } = supabase
    .storage
    .from('imagens')
    .getPublicUrl(filename);

  const imagem_url = publicUrlData.publicUrl;

  const { error: dbError } = await supabase
    .from('produtos')
    .insert([{ nome, preco, descricao, marca, tipo, condicao, imagem_url }]);

  if (dbError) {
    console.error(dbError);
    return res.status(500).send('Erro ao salvar item.');
  }

  res.send('Item cadastrado com sucesso!');
});



// Servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});


