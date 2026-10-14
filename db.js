require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'Muneeb3340.',
  database: process.env.DB_NAME || 'payrollmanagementdb',
  port: Number(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Connected to MySQL database successfully!');
    
    // Check current database
    const [dbResult] = await connection.query('SELECT DATABASE() AS currentDb');
    console.log(`📁 Active Database: ${dbResult[0].currentDb}`);

    // List existing tables
    const [tables] = await connection.query('SHOW TABLES');
    console.log(`📊 Found ${tables.length} table(s) in "${dbResult[0].currentDb}":`);
    if (tables.length > 0) {
      tables.forEach((t) => console.log('   - ' + Object.values(t)[0]));
    } else {
      console.log('   (Database is currently empty - ready for tables!)');
    }

    connection.release();
  } catch (err) {
    if (err.code === 'ER_BAD_DB_ERROR') {
      console.warn(`⚠️ Database "${process.env.DB_NAME}" does not exist yet.`);
      console.log('Attempting to create it automatically...');
      try {
        const rootConn = await mysql.createConnection({
          host: process.env.DB_HOST || 'localhost',
          user: process.env.DB_USER || 'root',
          password: process.env.DB_PASSWORD || 'Muneeb3340.',
          port: Number(process.env.DB_PORT) || 3306,
        });
        await rootConn.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME}\``);
        console.log(`🎉 Database "${process.env.DB_NAME}" created successfully!`);
        await rootConn.end();
        return testConnection();
      } catch (createErr) {
        console.error('❌ Failed to auto-create database:', createErr.message);
      }
    } else {
      console.error('❌ Database connection error:', err.message);
    }
  }
}

// If executed directly from command line, run the test
if (require.main === module) {
  testConnection().then(() => {
    // allow process to exit cleanly after test
    pool.end();
  });
}

module.exports = pool;
