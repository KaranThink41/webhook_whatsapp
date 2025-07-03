// server.js - WhatsApp related functions section
const axios = require('axios');

const { 
  WHATSAPP_TOKEN, 
  WHATSAPP_PHONE_NUMBER_ID, 
  WHATSAPP_API_URL 
} = require('./config');

const { apiRequest } = require('../utils/api');

// WhatsApp API helper functions
const sendWhatsAppMessage = async (to, message) => {
  try {
    const response = await apiRequest(WHATSAPP_API_URL, 'POST', {
      messaging_product: "whatsapp",
      to: to,
      ...message
    });
    return response;
  } catch (error) {
    console.error('Error sending WhatsApp message:', error.response?.data || error.message);
    throw error;
  }
};

const sendTextMessage = async (to, text) => {
  return sendWhatsAppMessage(to, {
    type: "text",
    text: { body: text }
  });
};

const sendInteractiveMessage = async (to, header, body, buttons) => {
  return sendWhatsAppMessage(to, {
    type: "interactive",
    interactive: {
      type: "button",
      header: { type: "text", text: header },
      body: { text: body },
      action: {
        buttons: buttons.map((btn, index) => ({
          type: "reply",
          reply: {
            id: btn.id,
            title: btn.title
          }
        }))
      }
    }
  });
};

const sendListMessage = async (to, header, body, sections) => {
  return sendWhatsAppMessage(to, {
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: header },
      body: { text: body },
      action: {
        button: "Select Option",
        sections: sections
      }
    }
  });
};

const downloadWhatsAppMedia = async (mediaId) => {
  try {
    // Get media URL from WhatsApp API
    const mediaResponse = await axios({
      method: 'GET',
      url: `https://graph.facebook.com/v18.0/${mediaId}`,
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`
      }
    });
    
    if (!mediaResponse.data || !mediaResponse.data.url) {
      throw new Error('Invalid media response from WhatsApp API');
    }
    
    // Download the actual media
    const mediaBuffer = await axios({
      method: 'GET',
      url: mediaResponse.data.url,
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`
      },
      responseType: 'arraybuffer'
    });
    
    return {
      buffer: Buffer.from(mediaBuffer.data),
      size: mediaBuffer.data.byteLength,
      contentType: mediaResponse.data.mime_type,
      url: mediaResponse.data.url
    };
  } catch (error) {
    console.error('Error downloading media:', error.response?.data || error.message);
    throw new Error(`Failed to download media: ${error.message}`);
  }
};

module.exports = {
  sendWhatsAppMessage,
  sendTextMessage,
  sendInteractiveMessage,
  sendListMessage,
  downloadWhatsAppMedia
};
