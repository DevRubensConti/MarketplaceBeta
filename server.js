// server.js
const http = require('http');
const app = require('./app'); // <- importa o app exportado acima

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});