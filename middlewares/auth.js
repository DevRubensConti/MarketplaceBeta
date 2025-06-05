function requireLogin(req, res, next) {
  if (!req.session?.usuario?.id) {
    return res.redirect('/login');
  }
  next();
}

function requireTipo(tipo) {
  return function (req, res, next) {
    if (!req.session?.usuario || req.session.usuario.tipo !== tipo) {
      return res.status(403).send('Acesso negado.');
    }
    next();
  };
}

module.exports = {
  requireLogin,
  requireTipo
};
