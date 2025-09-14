const app = require('./app');
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
// Exporta a instância do app
module.exports = app;