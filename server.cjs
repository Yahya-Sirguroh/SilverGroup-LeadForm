// Local dev entry point — loads .env then starts the Express server
require('dotenv').config();

const app  = require('./api/index.js');
const PORT = process.env.PORT || 5000;

const { MongoClient } = require('mongodb');
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) throw new Error('❌ MONGODB_URI environment variable is not set');

const client = new MongoClient(MONGODB_URI, { tls: true, tlsInsecure: true });
client.connect()
  .then(() => {
    console.log('✅ Connected to MongoDB');
    app.listen(PORT, () => {
      console.log(`\n🚀 Server running → http://localhost:${PORT}\n`);
      console.log('   GET  /api/projects');
      console.log('   GET  /api/users');
      console.log('   GET  /api/leads');
      console.log('   POST /api/leads');
      console.log('   POST /api/send-otp');
      console.log('   POST /api/verify-otp');
      console.log('   GET  /health');
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  });
