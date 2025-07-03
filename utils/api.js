// utils/api.js - API utility functions
const axios = require('axios');
const { DJANGO_BASE_URL, WHATSAPP_TOKEN } = require('../modules/config');

const apiRequest = async (endpoint, method = 'GET', data = null, options = {}) => {
  try {
    const config = {
      method,
      url: endpoint.startsWith('http') ? endpoint : `${DJANGO_BASE_URL}${endpoint}`,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      ...options
    };
    
    if (data) {
      config.data = data;
    }
    
    // Add authorization for WhatsApp API requests
    if (config.url.includes('graph.facebook.com')) {
      config.headers['Authorization'] = `Bearer ${WHATSAPP_TOKEN}`;
    }
    
    const response = await axios(config);
    return response.data;
  } catch (error) {
    console.error(`API Request Error (${endpoint}):`, error.response?.data || error.message);
    throw error;
  }
};

module.exports = {
  apiRequest
};
