// Configuration
module.exports = {
  WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN || 'your_whatsapp_access_token',
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || 'your_phone_number_id',
  WEBHOOK_VERIFY_TOKEN: process.env.WEBHOOK_VERIFY_TOKEN || 'your_webhook_verify_token',
  DJANGO_BASE_URL: process.env.DJANGO_BASE_URL || 
    'http://localhost:8000',
  WHATSAPP_API_URL: `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID || 'your_phone_number_id'}/messages`
};
