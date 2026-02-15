const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL || 'postgresql://triologue_user:simple_password_123@postgres:5432/triologue'
});

client.connect()
  .then(() => {
    console.log('✅ Database connection successful!');
    return client.query('SELECT current_user, current_database()');
  })
  .then(result => {
    console.log('Current user:', result.rows[0].current_user);
    console.log('Current database:', result.rows[0].current_database);
    return client.query('SELECT COUNT(*) FROM users');
  })
  .then(result => {
    console.log('Users in database:', result.rows[0].count);
    client.end();
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err.message);
    client.end();
  });