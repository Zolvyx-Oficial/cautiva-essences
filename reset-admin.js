require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./server/db');

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
const hash = bcrypt.hashSync(password, 10);

db.prepare('DELETE FROM admin_users').run();
db.prepare('INSERT INTO admin_users (email, password_hash) VALUES (?, ?)').run(email, hash);

console.log(`Usuario admin reseteado: ${email}`);