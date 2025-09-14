// server.js
const http = require('http');
const { Server } = require('socket.io');
const { app, sessionMiddleware, supabaseDb } = require('./app');

const server = http.createServer(app);
const io = new Server(server);

// Compartilha a sessão do Express com o Socket.io
io.engine.use(sessionMiddleware);

// ---------- Socket.io ----------
io.on('connection', (socket) => {
  const usuarioAtual = socket.request?.session?.usuario?.id;

  if (!usuarioAtual) {
    console.log('Socket sem sessão válida — desconectando.');
    socket.disconnect(true);
    return;
  }

  console.log(`Socket conectado: user=${usuarioAtual}`);

  socket.on('joinRoom', (chatId) => {
    if (!chatId) return;
    socket.join(chatId);
  });

  socket.on('send_message', async ({ chatId, mensagem }) => {
    try {
      if (!chatId || !mensagem || !mensagem.trim()) return;

      const { data, error } = await supabaseDb
        .from('mensagens')
        .insert([{ chat_id: chatId, id_remetente: usuarioAtual, mensagem: mensagem.trim() }])
        .select()
        .single();

      if (error) {
        console.error('Erro ao salvar mensagem no Supabase:', error);
        return;
      }

      io.to(chatId).emit('mensagemRecebida', data);
    } catch (err) {
      console.error('Erro inesperado ao salvar/enviar mensagem:', err);
    }
  });
});

// ---------- Inicializa o servidor ----------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
