const socket = io();
const room = roomNameGlobal;
socket.emit('join_room', room);

function enviarMensagem() {
    const msg = document.getElementById('mensagem').value;
    if (msg.trim() === '') return;

    socket.emit('send_message', {
        room: roomNameGlobal,
        message: msg,
        senderId: usuarioIdGlobal,
        recipientId: destinatarioIdGlobal,
        produtoId: produtoIdGlobal
    });

    document.getElementById('mensagem').value = '';
}

socket.on('receive_message', (data) => {
    const remetente = data.sender === usuarioIdGlobal ? 'Você' : `Usuário ${data.sender}`;
    adicionarMensagemNaTela(remetente, data.message);
});

function adicionarMensagemNaTela(usuario, mensagem) {
    const chat = document.getElementById('chat');
    chat.innerHTML += `<p><strong>${usuario}:</strong> ${mensagem}</p>`;
    chat.scrollTop = chat.scrollHeight;
}
