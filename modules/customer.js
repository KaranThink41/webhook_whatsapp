// server.js - Customer related functions section

const { DJANGO_BASE_URL } = require('./config');
const { apiRequest } = require('../utils/api');

// Customer management
const getOrCreateCustomer = async (phoneNumber, additionalData = {}) => {
  try {
    const customer = await apiRequest(`/api/customers/${phoneNumber}/`);
    return customer;
  } catch (error) {
    if (error.response?.status === 404) {
      // Create new customer
      const customerData = {
        phone_number: phoneNumber,
        ...additionalData
      };
      const newCustomer = await apiRequest(`/api/customers/${phoneNumber}/`, 'POST', customerData);
      return newCustomer;
    }
    throw error;
  }
};

module.exports = {
  getOrCreateCustomer
};
