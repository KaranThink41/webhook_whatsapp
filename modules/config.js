// Configuration
module.exports = {
  WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN || '',
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  WEBHOOK_VERIFY_TOKEN: process.env.WEBHOOK_VERIFY_TOKEN || 'default_webhook_token',
  DJANGO_BASE_URL: process.env.DJANGO_BASE_URL || 'http://localhost:8000',
  WHATSAPP_API_URL: `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID || 'YOUR_PHONE_NUMBER_ID'}/messages`
};
