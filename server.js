// Load environment variables first
require('dotenv').config({ path: '.env.local' });

const express = require('express');
const path = require('path');
const app = express();
const PORT = 3000;

// Test environment variables loading
console.log('🔑 Testing environment variables:');
console.log('TWILIO_ACCOUNT_SID:', process.env.TWILIO_ACCOUNT_SID ? '✅ Loaded' : '❌ Missing');
console.log('TWILIO_AUTH_TOKEN:', process.env.TWILIO_AUTH_TOKEN ? '✅ Loaded' : '❌ Missing');
console.log('TWILIO_PHONE_NUMBER:', process.env.TWILIO_PHONE_NUMBER ? '✅ Loaded' : '❌ Missing');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (your website)
app.use(express.static(path.join(__dirname)));

// Import webhook handler (after environment variables are loaded)
const webhookHandler = require('./api/webhook');

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// WhatsApp webhook route
app.post('/api/webhook', webhookHandler);
app.get('/api/webhook', (req, res) => {
  // Webhook verification for Twilio
  res.status(200).send('Webhook is working!');
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Fast Cab server is running!',
    timestamp: new Date().toISOString(),
    environment: {
      twilioConfigured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
      nodeVersion: process.version
    }
  });
});

app.listen(PORT, () => {
  console.log('🚀 Fast Cab server running on http://localhost:3000');
  console.log('📱 WhatsApp webhook ready at /api/webhook');
  console.log('💚 Website available at http://localhost:3000');
  console.log('🔍 Health check at http://localhost:3000/health');
});