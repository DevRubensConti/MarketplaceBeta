const express = require('express');
const router = express.Router();
const isAuthenticated = require('../middlewares/auth');

// Página de cadastro de item
router.get('/cadastro-item', isAuthenticated, (req, res) => {
  res.render('cadastro-item');
});

// Comprar produto
router.post('/comprar/:id', isAuthenticated, (req, res) => {
  // lógica de compra
  res.send('Compra efetuada!');
});

// Adicionar ao carrinho
router.post('/carrinho/adicionar/:id', isAuthenticated, (req, res) => {
  // lógica de carrinho
  res.send('Produto adicionado ao carrinho.');
});

module.exports = router;
