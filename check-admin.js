require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./server/db');

console.log('--- .env ---');
console.log('ADMIN_EMAIL    =', JSON.stringify(process.env.ADMIN_EMAIL));
console.log('ADMIN_PASSWORD =', JSON.stringify(process.env.ADMIN_PASSWORD));

console.log('\n--- usuarios en la base de datos ---');
const users = db.prepare('SELECT id, email, password_hash FROM admin_users').all();
if (users.length === 0) console.log('(no hay ningun usuario admin)');
users.forEach(u => {
  const match = bcrypt.compareSync(process.env.ADMIN_PASSWORD || '', u.password_hash);
  console.log(`id=${u.id}  email=${JSON.stringify(u.email)}  password_del_env_coincide=${match}`);
});