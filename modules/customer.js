// server.js - Customer related functions section

const { DJANGO_BASE_URL } = require('./config');
const { apiRequest } = require('../utils/api');

// Customer management
const getOrCreateCustomer = async (phoneNumber, additionalData = {}) => {
  try {
    console.log(`Fetching customer with phone: ${phoneNumber}`);
    const customer = await apiRequest(`/api/customers/${phoneNumber}/`);
    console.log('Found existing customer:', JSON.stringify(customer, null, 2));
    
    // If we have additional data, update the customer
    if (Object.keys(additionalData).length > 0) {
      console.log('Updating customer with additional data:', additionalData);
      const updatedCustomer = await apiRequest(
        `/api/customers/${phoneNumber}/`,
        'PATCH',
        additionalData
      );
      console.log('Customer updated successfully:', JSON.stringify(updatedCustomer, null, 2));
      return updatedCustomer;
    }
    
    return customer;
  } catch (error) {
    if (error.response?.status === 404) {
      console.log('Customer not found, creating new customer with data:', {
        phoneNumber,
        ...additionalData
      });
      
      // Create new customer
      const customerData = {
        phone_number: phoneNumber,
        ...additionalData
      };
      
      try {
        const newCustomer = await apiRequest(
          `/api/customers/${phoneNumber}/`,
          'POST',
          customerData
        );
        console.log('Created new customer:', JSON.stringify(newCustomer, null, 2));
        return newCustomer;
      } catch (createError) {
        console.error('Error creating customer:', {
          error: createError.response?.data || createError.message,
          status: createError.response?.status,
          customerData
        });
        throw new Error(`Failed to create customer: ${createError.message}`);
      }
    }
    
    console.error('Error in getOrCreateCustomer:', {
      error: error.response?.data || error.message,
      status: error.response?.status,
      phoneNumber,
      additionalData
    });
    
    throw error;
  }
};

module.exports = {
  getOrCreateCustomer
};
