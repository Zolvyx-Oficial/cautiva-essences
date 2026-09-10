// server/middleware/auth.js
const jwt = require('jsonwebtoken');

function requireAdmin(req, res, next) {
  const token = req.cookies?.essenza_admin_token;
  if (!token) return res.status(401).json({ error: 'No autenticado. Inicia sesión en /admin.' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesión inválida o expirada. Vuelve a iniciar sesión.' });
  }
}

module.exports = { requireAdmin };
