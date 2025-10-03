// app.js
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const supabaseDb = require('./supabase/supabaseDb');

const app = express();

// ---------- Middlewares globais ----------
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Uma instância de session para compartilhar com o Socket.io
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 dia
});
app.use(sessionMiddleware);

// Disponibiliza o usuário nas views
app.use((req, res, next) => {
  res.locals.usuario = req.session.usuario || null;
  next();
});

// ---------- EJS e estáticos ----------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Rotas ----------
app.use('/', require('./routes/index'));
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/produtos'));
app.use('/', require('./routes/perfil'));
app.use('/', require('./routes/loja'));
app.use('/', require('./routes/carrinho'));
app.use('/', require('./routes/pedidos'));
app.use('/', require('./routes/chat'));
app.use('/', require('./routes/modelos'));
app.use('/', require('./routes/descricao'));
app.use('/', require('./routes/avaliacoes'));
app.use('/', require('./routes/financeiro'));
app.use('/', require('./routes/ofertas'));
app.use('/', require('./routes/recs'));

// healthcheck opcional
app.get('/health', (_req, res) => res.send('ok'));

// Exporta o app + middleware de sessão (para o Socket.io usar no server.js)
module.exports = { app, sessionMiddleware, supabaseDb };
