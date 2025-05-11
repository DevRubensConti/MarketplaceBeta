require('dotenv').config();

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

//Open AI 
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
app.get('/', async (req, res) => {
  const { data: produtos, error } = await supabase
    .from('produtos')
    .select('*')
    .order('id', { ascending: false }) // pode trocar por campo de popularidade
    .limit(8); // limitar para exibir os 8 mais acessados

  if (error) {
    console.error(error);
    return res.status(500).send('Erro ao buscar produtos.');
  }

  res.render('index', {produtos});
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
app.post('/cadastro-item', upload.array('imagens', 12), async (req, res) => {
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
      .upload(filename, file.buffer, {
        contentType: file.mimetype
      });

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

  // Dados do formulário
  const {
    nome,
    descricao,
    preco,
    marca,
    marca_personalizada,
    tipo,
    condicao,
    tags,
    ano_fabricacao,
    cor,
    captadores,
    captadores_config,
    madeira,
    pais_fabricacao,
    cordas,
    usuario_id
  } = req.body;

  // Marca final
  const marcaFinal = marca === 'Outra...' ? marca_personalizada : marca;

  const { error: dbError } = await supabase
    .from('produtos')
    .insert([{
      nome,
      descricao,
      preco: parseFloat(preco),
      marca: marcaFinal,
      tipo,
      condicao,
      imagens_url: imagemUrls.join(','), // Se for text no banco
      usuario_id,
      ano_fabricacao,
      captadores,
      captadores_config,
      madeira,
      tags,
      pais_fabricacao,
      cor,
      cordas
    }]);

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


app.post('/gerar-descricao', async (req, res) => {
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
      messages: [{ role: 'user', content: prompt }],
    });

    const descricao = openaiResponse.choices[0].message.content;
    res.json({ descricao });
  } catch (error) {
    console.error('Erro ao gerar descrição:', error);
    res.status(500).send('Erro ao gerar descrição automática.');
  }
});