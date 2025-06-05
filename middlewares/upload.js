const multer = require('multer');

const storage = multer.memoryStorage(); // salva na RAM
const upload = multer({ storage });     // middleware de upload

module.exports = upload;
