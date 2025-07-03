// server.js - Updated to integrate with Django backend
const express = require('express');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuration
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || 'your_whatsapp_access_token';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || 'your_phone_number_id';
const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || 'WkLp!9x#Zq7$Hj2@Mv_d';
const DJANGO_BASE_URL = process.env.DJANGO_BASE_URL || 'https://backend-whatsapp-7z8a.onrender.com';
const WHATSAPP_API_URL = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

// Native HTTP/HTTPS request function as fallback when axios fails
const makeNativeRequest = (url, method = 'GET', requestData = null) => {
  return new Promise((resolve, reject) => {
    try {
      // Parse the URL to determine if we need http or https
      const parsedUrl = new URL(url);
      const httpModule = parsedUrl.protocol === 'https:' ? https : http;
      
      const options = {
        method: method,
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 15000 // 15 seconds timeout
      };
      
      console.log(`Making native ${method} request to ${url}`);
      
      const req = httpModule.request(url, options, (res) => {
        let data = '';
        
        // Log response info
        console.log(`Native request status: ${res.statusCode}`);
        
        // Handle response data
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        // When the response is complete
        res.on('end', () => {
          // Check if we got a successful status code
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              // Try to parse as JSON
              const parsedData = JSON.parse(data);
              resolve(parsedData);
            } catch (e) {
              console.warn(`Failed to parse response as JSON: ${e.message}`);
              // If we can't parse as JSON, resolve with the raw data
              resolve({
                rawData: data,
                statusCode: res.statusCode,
                headers: res.headers
              });
            }
          } else {
            // Handle error status codes
            reject(new Error(`Request failed with status code ${res.statusCode}: ${data}`));
          }
        });
      });
      
      // Handle request errors
      req.on('error', (error) => {
        console.error('Native request error:', error.message);
        reject(error);
      });
      
      // Handle timeouts
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out'));
      });
      
      // Send the request data if provided
      if (requestData) {
        const dataString = typeof requestData === 'string' ? 
          requestData : JSON.stringify(requestData);
        req.write(dataString);
      }
      
      // End the request
      req.end();
      
    } catch (error) {
      console.error('Error in native request setup:', error.message);
      reject(error);
    }
  });
};

// --- Django API Helper Functions ---
const apiRequest = async (endpoint, method = 'GET', data = null, retries = 3) => {
  try {
    console.log(`Making ${method} request to ${DJANGO_BASE_URL}${endpoint}`);
    
    const config = {
      method,
      url: `${DJANGO_BASE_URL}${endpoint}`,
      headers: {
        'Content-Type': 'application/json',
      },
      // Add timeout to prevent hanging requests
      timeout: 10000, // 10 seconds
      // Prevent automatic parsing of response if it might be malformed
      transformResponse: [(data) => {
        try {
          // Try to parse as JSON
          return JSON.parse(data);
        } catch (e) {
          // If parsing fails, return the raw data for manual handling
          console.warn(`Failed to parse response as JSON: ${e.message}`);
          return { rawData: data, parseError: e.message };
        }
      }],
      // Validate status to ensure we handle all non-2xx responses
      validateStatus: (status) => {
        return status >= 200 && status < 300; // default
      }
    };
    
    if (data) {
      config.data = data;
    }
    
    const response = await axios(config);
    
    // Check if we got a valid response
    if (response.data && response.data.parseError) {
      throw new Error(`Invalid response format: ${response.data.parseError}`);
    }
    
    return response.data;
  } catch (error) {
    // Log detailed error information
    console.error(`API Request Error (${endpoint}):`, {
      message: error.message,
      code: error.code,
      url: `${DJANGO_BASE_URL}${endpoint}`,
      method,
      responseData: error.response?.data,
      responseStatus: error.response?.status,
      responseHeaders: error.response?.headers
    });
    
    // Handle specific error types
    if (error.code === 'ERR_BAD_RESPONSE') {
      console.log('Received ERR_BAD_RESPONSE - trying native request as fallback');
      
      try {
        // Try using the native request function as a fallback
        const nativeResponse = await makeNativeRequest(
          `${DJANGO_BASE_URL}${endpoint}`,
          method,
          data
        );
        console.log('Native request successful');
        return nativeResponse;
      } catch (nativeError) {
        console.error('Native request also failed:', nativeError.message);
        
        // If native request also fails and we have retries left, try again with axios
        if (retries > 0) {
          console.log(`Retrying request with axios (${retries} attempts left)...`);
          // Wait for a short time before retrying
          await new Promise(resolve => setTimeout(resolve, 1000));
          return apiRequest(endpoint, method, data, retries - 1);
        }
      }
    } else if (retries > 0) {
      // For other errors, retry with axios if we have retries left
      console.log(`Retrying request (${retries} attempts left)...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      return apiRequest(endpoint, method, data, retries - 1);
    }
    
    // For ECONNREFUSED errors, provide more helpful message
    if (error.code === 'ECONNREFUSED') {
      console.error(`Connection refused to ${DJANGO_BASE_URL}. Is the backend server running?`);
    }
    
    throw error;
  }
};

// Session management with Django backend
const getUserSession = async (phoneNumber) => {
  // Add specific debugging for this endpoint
  console.log(`=== Getting session for ${phoneNumber} ===`);
  console.log(`Backend URL: ${DJANGO_BASE_URL}/api/whatsapp-session/${phoneNumber}/`);
  
  // First try a direct request with more detailed error handling
  try {
    // Try a direct request with raw response handling
    const directResponse = await axios({
      method: 'GET',
      url: `${DJANGO_BASE_URL}/api/whatsapp-session/${phoneNumber}/`,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'WhatsAppBot/1.0'
      },
      timeout: 15000,
      responseType: 'text', // Get raw text response to handle parsing manually
      validateStatus: null // Don't throw on any status code
    });
    
    // Log detailed response information
    console.log(`Direct response status: ${directResponse.status}`);
    console.log(`Response headers:`, directResponse.headers);
    console.log(`Response size: ${directResponse.data?.length || 0} bytes`);
    
    // Check if response is valid
    if (directResponse.status >= 200 && directResponse.status < 300) {
      try {
        // Try to parse the response as JSON
        const sessionData = typeof directResponse.data === 'string' ? 
          JSON.parse(directResponse.data) : directResponse.data;
        
        // Validate session data
        if (!sessionData || typeof sessionData !== 'object') {
          console.warn(`Invalid session data format for ${phoneNumber}:`, sessionData);
          return createDefaultSession(phoneNumber);
        }
        
        console.log(`Successfully retrieved session for ${phoneNumber}`);
        return sessionData;
      } catch (parseError) {
        console.error(`Error parsing session response: ${parseError.message}`);
        console.error(`Response content: ${directResponse.data?.substring(0, 200)}...`);
        return createDefaultSession(phoneNumber);
      }
    } else if (directResponse.status === 404) {
      console.log(`No session found for ${phoneNumber}, creating new one`);
      // Create new session if not found
      try {
        const newSession = await apiRequest(`/api/whatsapp-session/${phoneNumber}/`, 'POST', {
          current_step: 'start',
          context_data: {}
        });
        return newSession;
      } catch (createError) {
        console.error(`Failed to create new session for ${phoneNumber}:`, createError.message);
        return createDefaultSession(phoneNumber);
      }
    } else {
      // Other error status codes
      console.error(`Error status ${directResponse.status} when getting session for ${phoneNumber}`);
      throw new Error(`HTTP error ${directResponse.status}`);
    }
  } catch (directError) {
    console.error(`Direct request error for ${phoneNumber}:`, directError.message);
    
    // Fall back to standard apiRequest with additional error handling
    try {
      console.log(`Falling back to standard apiRequest for ${phoneNumber}`);
      const session = await apiRequest(`/api/whatsapp-session/${phoneNumber}/`);
      
      // Validate session data
      if (!session || typeof session !== 'object') {
        console.warn(`Invalid session data received for ${phoneNumber}:`, session);
        return createDefaultSession(phoneNumber);
      }
      
      return session;
    } catch (error) {
      console.error(`Error getting session for ${phoneNumber}:`, error.message);
      
      // Handle specific error cases
      if (error.response?.status === 404) {
        console.log(`No session found for ${phoneNumber}, creating new one`);
        // Create new session if not found
        try {
          const newSession = await apiRequest(`/api/whatsapp-session/${phoneNumber}/`, 'POST', {
            current_step: 'start',
            context_data: {}
          });
          return newSession;
        } catch (createError) {
          console.error(`Failed to create new session for ${phoneNumber}:`, createError.message);
          return createDefaultSession(phoneNumber);
        }
      }
      
      // For ERR_BAD_RESPONSE or other critical errors, return a default session
      if (error.code === 'ERR_BAD_RESPONSE' || error.code === 'ECONNREFUSED' || !error.response) {
        console.warn(`Backend connection issue for ${phoneNumber}, using default session`);
        return createDefaultSession(phoneNumber);
      }
      
      // For other errors, still return a default session but log the full error
      console.error('Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
      return createDefaultSession(phoneNumber);
    }
  }
};

// Helper function to create a default session when backend is unavailable
const createDefaultSession = (phoneNumber) => {
  console.log(`Creating default fallback session for ${phoneNumber}`);
  return {
    phone_number: phoneNumber,
    current_step: 'start',
    context_data: {},
    is_fallback: true, // Flag to indicate this is a fallback session
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
};

const updateUserSession = async (phoneNumber, updates) => {
  try {
    console.log(`Updating session for ${phoneNumber}`, updates);
    const session = await apiRequest(`/api/whatsapp-session/${phoneNumber}/`, 'POST', updates);
    
    // Validate session data
    if (!session || typeof session !== 'object') {
      console.warn(`Invalid session data received when updating ${phoneNumber}:`, session);
      // Return the updates as a fallback
      return {
        ...updates,
        phone_number: phoneNumber,
        is_fallback: true,
        updated_at: new Date().toISOString()
      };
    }
    
    return session;
  } catch (error) {
    console.error(`Error updating session for ${phoneNumber}:`, error.message);
    
    // For critical errors, return a session with the updates applied
    // This ensures the bot can continue functioning even if the backend is having issues
    if (error.code === 'ERR_BAD_RESPONSE' || error.code === 'ECONNREFUSED' || !error.response) {
      console.warn(`Backend connection issue when updating session for ${phoneNumber}, using local fallback`);
      // Get the current session first (which might be a fallback session)
      try {
        const currentSession = await getUserSession(phoneNumber);
        return {
          ...currentSession,
          ...updates,
          is_fallback: true,
          updated_at: new Date().toISOString()
        };
      } catch (sessionError) {
        // If we can't even get the current session, just return the updates
        return {
          ...updates,
          phone_number: phoneNumber,
          is_fallback: true,
          updated_at: new Date().toISOString()
        };
      }
    }
    
    // Log the full error for debugging
    console.error('Full update error:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    
    // Return a fallback session with the updates
    return {
      ...updates,
      phone_number: phoneNumber,
      is_fallback: true,
      updated_at: new Date().toISOString()
    };
  }
};

// Customer management
const getOrCreateCustomer = async (phoneNumber, additionalData = {}) => {
  try {
    console.log(`Fetching customer data for ${phoneNumber}`);
    // Use the whatsapp-session endpoint instead of customers
    const customer = await apiRequest(`/api/whatsapp-session/${phoneNumber}/`);
    
    // If customer data exists in the session, use it
    if (customer && customer.context_data && customer.context_data.customer_info) {
      return customer.context_data.customer_info;
    }
    
    // Otherwise create a basic customer object
    const customerData = {
      phone_number: phoneNumber,
      ...additionalData
    };
    
    // Store customer data in the session
    await updateUserSession(phoneNumber, {
      context_data: {
        customer_info: customerData
      }
    });
    
    return customerData;
  } catch (error) {
    console.error(`Error getting customer ${phoneNumber}:`, error.message);
    
    // If session doesn't exist or other error occurs
    try {
      console.log(`Creating new customer session for ${phoneNumber}`);
      const customerData = {
        phone_number: phoneNumber,
        ...additionalData
      };
      
      // Create a new session with customer data
      const newSession = await apiRequest(`/api/whatsapp-session/${phoneNumber}/`, 'POST', {
        current_step: 'start',
        context_data: {
          customer_info: customerData
        }
      });
      
      return customerData;
    } catch (createError) {
      console.error(`Failed to create customer session: ${createError.message}`);
      // Return a fallback customer object
      return {
        phone_number: phoneNumber,
        is_fallback: true,
        ...additionalData
      };
    }
  }
};

// Medicine and catalog functions
const getCategories = async () => {
  try {
    const response = await apiRequest('/categories/');
    // Handle different possible response formats
    if (Array.isArray(response)) {
      return response; // If response is already an array
    } else if (response && Array.isArray(response.results)) {
      return response.results; // If response has a results array (common in paginated APIs)
    } else if (response && response.data && Array.isArray(response.data)) {
      return response.data; // If response has a data array
    }
    console.warn('Unexpected categories format:', response);
    return [];
  } catch (error) {
    console.error('Error fetching categories:', error);
    return [];
  }
};

const getMedicinesByCategory = async (categoryId) => {
  try {
    const response = await apiRequest(`/medicines/?category=${categoryId}`);
    
    // Handle different possible response formats
    if (Array.isArray(response)) {
      return response; // If response is already an array
    } else if (response && Array.isArray(response.results)) {
      return response.results; // If response has a results array (common in paginated APIs)
    } else if (response && response.data && Array.isArray(response.data)) {
      return response.data; // If response has a data array
    }
    
    console.warn('Unexpected medicines by category format:', response);
    return [];
  } catch (error) {
    console.error('Error fetching medicines by category:', error);
    return [];
  }
};

const searchMedicines = async (query, limit = 5) => {
  try {
    // Use medicine_suggestions endpoint based on backend structure
    const medicines = await apiRequest(`/medicine_suggestions/?symptom=${encodeURIComponent(query)}&limit=${limit}`);
    return medicines;
  } catch (error) {
    console.error('Error searching medicines:', error);
    return [];
  }
};

const getMedicineById = async (medicineId) => {
  try {
    // Since there's no medicine by ID endpoint, return hardcoded medicine
    console.log('Using hardcoded medicine for ID:', medicineId);
    const medicine = {
      id: medicineId,
      name: 'Paracetamol',
      description: 'Pain relief medication',
      price: 10.99,
      image: 'https://example.com/medicine-image.jpg'
    };
    return medicine;
  } catch (error) {
    console.error('Error fetching medicine by ID:', error);
    return null;
  }
};

// Order management
const getUserOrders = async (phoneNumber) => {
  try {
    console.log(`Fetching orders for phone: ${phoneNumber}`);
    
    // Get user session which may contain order data in context
    const session = await apiRequest(`/api/whatsapp-session/${phoneNumber}/`);
    
    // Check if there are orders in the session context
    if (session && session.context_data && session.context_data.orders) {
      console.log('Found orders in session context');
      return Array.isArray(session.context_data.orders) ? session.context_data.orders : [];
    }
    
    // If no orders in session, return empty array
    console.log('No orders found in session');
    return [];
  } catch (error) {
    console.error('Error fetching user orders:', error);
    if (error.response) {
      console.error('Error response:', {
        status: error.response.status,
        data: error.response.data,
        headers: error.response.headers
      });
    }
    
    // Return test orders for development
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
      console.log('Returning test orders for development');
      return [{
        id: 'test-order-1',
        order_number: 'WA12345',
        status: 'processing',
        created_at: new Date().toISOString(),
        total_amount: 249.99,
        items: [{ name: 'Paracetamol', quantity: 2 }]
      }];
    }
    
    return [];
  }
};

const createQuickOrder = async (phoneNumber, orderItems, additionalData = {}) => {
  try {
    const customer = await getOrCreateCustomer(phoneNumber);
    
    // Get the first pharmacy based on delivery address
    const deliveryAddress = additionalData.delivery_address || {};
    const pharmacies = await getNearbyPharmacies(deliveryAddress.city, deliveryAddress.pincode);
    const pharmacyId = pharmacies.length > 0 ? pharmacies[0].id : null;
    
    if (!pharmacyId) {
      throw new Error('No pharmacy available to fulfill this order');
    }
    
    const orderData = {
      customer_phone: phoneNumber,
      pharmacy_id: pharmacyId,
      medicines: orderItems.map(item => ({
        medicine_id: item.medicine_id || item.id,
        quantity: item.quantity || 1,
        prescription_file: item.prescription_file || null
      })),
      ...additionalData
    };
    
    console.log('Creating order with data:', orderData);
    // Store order in the user's session context instead of dedicated order endpoint
    const sessionUpdate = await apiRequest(`/api/whatsapp-session/${phoneNumber}/`, 'POST', {
      context_data: {
        orders: [orderData]
      }
    });
    
    // Create a local order object with generated ID
    const order = {
      id: `order-${Date.now()}`,
      order_number: `WA${Math.floor(10000 + Math.random() * 90000)}`,
      status: 'received',
      created_at: new Date().toISOString(),
      ...orderData
    };
    return order;
  } catch (error) {
    console.error('Error creating order:', error);
    throw error;
  }
};

// Pharmacy functions
// const getNearbyPharmacies = async (city = null, pincode = null) => {
//   try {
//     const params = new URLSearchParams();
//     if (city) params.append('city', city);
//     if (pincode) params.append('pincode', pincode);
    
//     const queryString = params.toString();
//     const endpoint = `/pharmacies/nearby/${queryString ? '?' + queryString : ''}`;
    
//     const pharmacies = await apiRequest(endpoint);
//     return pharmacies;
//   } catch (error) {
//     console.error('Error fetching nearby pharmacies:', error);
//     return [];
//   }
// };
const getNearbyPharmacies = async (city = null, pincode = null) => {
    try {
      const params = new URLSearchParams();
      if (city) params.append('city', city);
      if (pincode) params.append('pincode', pincode);
      
      // Use pharmacy_nearby endpoint based on backend structure
      const response = await apiRequest(`/pharmacy_nearby/?${params.toString()}`);
      return response;
    } catch (error) {
      console.error('Error fetching pharmacies:', error);
      
      // For testing - return a test pharmacy if none found
      // Remove this in production
      if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
        console.log('Returning test pharmacy for development');
        return [{
          id: 'test-pharmacy-1',
          name: 'Test Pharmacy',
          address: '123 Test St, Test City',
          phone: '+1234567890',
          pincodes: ['110001', '110002', '110003'], // Add test pincodes here
          is_active: true
        }];
      }
      
      throw error;
    }
  };

// Prescription upload (you'll need to implement file storage)
const uploadPrescription = async (fileBuffer, fileName, phoneNumber) => {
  try {
    // This is a simplified version - you'll need to implement actual file upload
    // to your Django backend's media storage
    console.log(`Uploading prescription for ${phoneNumber} - ${fileName}`);
    
    // For now, return a mock response - implement actual upload to Django
    const mockPublicUrl = `${DJANGO_BASE_URL}/media/prescriptions/${phoneNumber}/${fileName}`;
    return {
      path: `prescriptions/${phoneNumber}/${fileName}`,
      publicUrl: mockPublicUrl,
      fileName: fileName
    };
  } catch (error) {
    console.error('Error uploading prescription:', error);
    throw error;
  }
};

// WhatsApp API helper functions (unchanged)
const sendWhatsAppMessage = async (to, message) => {
  try {
    const response = await axios.post(
      WHATSAPP_API_URL,
      {
        messaging_product: "whatsapp",
        to: to,
        ...message
      },
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error('Error sending WhatsApp message:', error.response?.data || error.message);
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
    // Get media URL from WhatsApp
    const mediaResponse = await axios.get(`https://graph.facebook.com/v18.0/${mediaId}`, {
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`
      }
    });
    
    // Download the actual media
    const mediaBuffer = await axios.get(mediaResponse.data.url, {
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`
      },
      responseType: 'arraybuffer'
    });
    
    return {
      buffer: Buffer.from(mediaBuffer.data),
      size: mediaBuffer.data.byteLength,
      contentType: mediaResponse.data.mime_type
    };
  } catch (error) {
    console.error('Error downloading media:', error);
    throw error;
  }
};

// Helper function for handling checkout with prescription
async function handleCheckoutWithPrescription(phoneNumber, session, prescriptionPath) {
  const cart = session.context_data.cart || [];
  
  if (cart.length === 0) {
    await sendTextMessage(phoneNumber, "Your cart is empty. Add some medicines first!");
    return;
  }
  
  // Prepare order items
  const orderItems = cart.map(item => ({
    medicine_id: item.medicine_id,
    quantity: item.quantity,
    prescription_file: item.requires_prescription ? prescriptionPath : null
  }));
  
  try {
    // Get customer details including address
    const customer = await getOrCreateCustomer(phoneNumber);
    
    // Create order with delivery address
    const order = await createQuickOrder(phoneNumber, orderItems, {
      delivery_address: {
        address: customer.address,
        city: customer.city, // Make sure city is saved in customer details
        pincode: customer.pincode,
        landmark: customer.landmark
      }
    });
    
    // Clear cart after successful order
    await updateUserSession(phoneNumber, {
      current_step: 'browse_medicines',
      context_data: { cart: [] }
    });
    
    // Send order confirmation
    await sendTextMessage(phoneNumber, 
      `✅ Order placed successfully!\n\n` +
      `📋 Order ID: ${order.order_id}\n` +
      `💰 Total: ₹${order.total_amount}\n\n` +
      `Your order will be processed within 2 hours.`
    );
    
    await sendInteractiveMessage(phoneNumber, "Next Steps", "What would you like to do next?", [
      { id: "track_order", title: "Track Order" },
      { id: "browse_categories", title: "Continue Shopping" },
      { id: "main_menu", title: "Main Menu" }
    ]);
    
  } catch (error) {
    console.error('Checkout error:', error);
    
    // More detailed error message
    let errorMessage = "❌ Failed to place order.\n\n";
    
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error('Error response data:', error.response.data);
      console.error('Error status:', error.response.status);
      console.error('Error headers:', error.response.headers);
      
      errorMessage += `Error: ${error.response.status} - ${error.response.statusText}\n`;
      if (error.response.data) {
        if (typeof error.response.data === 'object') {
          errorMessage += `Details: ${JSON.stringify(error.response.data, null, 2)}`;
        } else {
          errorMessage += `Details: ${error.response.data}`;
        }
      }
    } else if (error.request) {
      // The request was made but no response was received
      console.error('Error request:', error.request);
      errorMessage += "The server did not respond. Please check your internet connection and try again.";
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('Error message:', error.message);
      errorMessage += `Error: ${error.message}`;
    }
    
    // Send the detailed error message to the user
    await sendTextMessage(phoneNumber, errorMessage);
    
    // Also log the full error for debugging
    console.error('Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    
    // If there's a specific error about missing address, guide the user
    if (error.message && (error.message.includes('address') || error.message.includes('pincode'))) {
      await sendTextMessage(phoneNumber, 
        "\n\nIt looks like we're missing your delivery address. " +
        "Please update your address and try again. You can update it by sending: \n\n" +
        "*Update Address*\n[Your Complete Address]\n[City]\n[Pincode]\n[Landmark (optional)]"
      );
    }
  }
}

// Helper function for handling delivery details
async function handleDeliveryDetails(phoneNumber, session) {
  await updateUserSession(phoneNumber, {
    current_step: 'awaiting_delivery_details',
    context_data: {
      ...session.context_data,
      checkout_in_progress: true
    }
  });
  
  await sendTextMessage(phoneNumber,
    "🚚 *Delivery Details*\n\n" +
    "Please provide your delivery details in the following format:\n\n" +
    "1. Full Name\n" +
    "2. Complete Address\n" +
    "3. Pincode\n" +
    "4. Landmark (Optional)\n\n" +
    "Example:\n" +
    "John Doe\n" +
    "123 Main St, Apartment 4B\n" +
    "400001\n" +
    "Near City Mall"
  );
  
  await sendInteractiveMessage(phoneNumber, "Delivery Details", "You can also:", [
    { id: "cancel_checkout", title: "❌ Cancel Checkout" }
  ]);
}

// Main message handler - Updated to use Django backend
const handleIncomingMessage = async (from, message) => {
  try {
    const session = await getUserSession(from);
    
    // Handle media messages (prescription uploads)
    if (message.type === 'image' && 
        (session.context_data?.awaiting_prescription || session.context_data?.checkout_in_progress)) {
      const mediaInfo = await downloadWhatsAppMedia(message.image.id);
      const fileName = `prescription_${Date.now()}_${message.image.id}.jpg`;
      
      // Upload prescription
      const uploadResult = await uploadPrescription(
        mediaInfo.buffer, 
        fileName, 
        from
      );
      
      if (session.context_data.checkout_in_progress) {
        // Handle checkout with prescription
        await handleCheckoutWithPrescription(from, session, uploadResult.path);
      } else {
        // Handle single medicine order with prescription
        const medicine = session.context_data.awaiting_prescription;
        
        // Create order with prescription
        const orderItems = [{
          medicine_id: medicine.id,
          quantity: 1,
          prescription_file: uploadResult.path
        }];
        
        const order = await createQuickOrder(from, orderItems);
        
        // Update session
        await updateUserSession(from, {
          current_step: 'browse_medicines',
          context_data: {}
        });
        
        await sendTextMessage(from, 
          `✅ Prescription received and *${medicine.name}* ordered successfully!\n\n` +
          `📋 Order ID: ${order.order_id}\n` +
          `💰 Total: ₹${order.total_amount}\n\n` +
          `Your order will be processed within 2 hours.`
        );
      }
      
      await sendInteractiveMessage(from, "Next Action", "What would you like to do?", [
        { id: "browse_categories", title: "Browse Categories" },
        { id: "track_order", title: "Track Orders" },
        { id: "main_menu", title: "Main Menu" }
      ]);
      
      return;
    }

    // Handle text messages and button replies
    const messageText = message.text?.body?.toLowerCase() || 
                       message.interactive?.button_reply?.title?.toLowerCase() ||
                       message.interactive?.list_reply?.title?.toLowerCase() || '';

    // Welcome message and main menu
    if (messageText.includes('hi') || messageText.includes('hello') || 
        messageText.includes('start') || messageText === 'main menu') {
      
      await updateUserSession(from, { 
        current_step: 'main_menu', 
        context_data: {} 
      });
      
      // Ensure customer exists
      await getOrCreateCustomer(from);
      
      const sections = [
        {
          title: "Main Options",
          rows: [
            { id: "browse_categories", title: "Browse Categories", description: "Explore medicines by category" },
            { id: "search_medicines", title: "Search Medicines", description: "Find specific medicines" },
            { id: "upload_prescription", title: "Upload Prescription", description: "Submit your doctor's prescription" },
            { id: "track_order", title: "Track Orders", description: "Check status of your orders" },
            { id: "find_pharmacy", title: "Find Pharmacy", description: "Locate nearby pharmacies" }
          ]
        }
      ];

      await sendListMessage(from, 
        "🏥 Welcome to PharmaCare Bot!", 
        "How can I help you today? Select an option from the list below:",
        sections
      );
      return;
    }

    // Handle Browse Categories
    if (messageText === 'browse categories') {
      const categories = await getCategories();
      
      if (categories.length === 0) {
        await sendTextMessage(from, "Sorry, no categories available at the moment.");
        return;
      }
      
      await updateUserSession(from, { 
        current_step: 'browse_categories',
        context_data: {}
      });
      
      // Ensure categories is an array before processing
      if (!Array.isArray(categories)) {
        console.error('Categories is not an array:', categories);
        categories = [];
      }
      
      const sections = [{
        title: "Medicine Categories",
        rows: categories.slice(0, 10).map(category => ({
          id: `cat_${category.id}`,
          title: category.name || 'Unnamed Category',
          description: (category.description || `Browse ${category.name || 'category'} medicines`).substring(0, 72) // Limit description length
        }))
      }];
      
      await sendListMessage(from, 
        "🏥 Medicine Categories", 
        "Select a category to browse medicines:",
        sections
      );
      return;
    }

    // Handle category selection
    if (messageText.startsWith('cat_') || (message.interactive?.list_reply?.id && message.interactive.list_reply.id.startsWith('cat_'))) {
      // Extract category ID from either direct message or interactive message
      const categoryId = messageText.startsWith('cat_') 
        ? messageText.replace('cat_', '')
        : message.interactive.list_reply.id.replace('cat_', '');
        
      const medicines = await getMedicinesByCategory(categoryId);
      
      if (medicines.length === 0) {
        await sendTextMessage(from, "Sorry, no medicines available in this category.");
        return;
      }
      
      await updateUserSession(from, {
        current_step: 'browse_medicines',
        context_data: { current_category: categoryId }
      });
      
      const sections = [{
        title: "Available Medicines",
        rows: medicines.slice(0, 10).map(medicine => ({
          id: `med_${medicine.id}`,
          title: medicine.name,
          description: `₹${medicine.mrp} ${medicine.prescription_type === 'RX' ? '(Rx Required)' : ''}`
        }))
      }];
      
      await sendListMessage(from, 
        "💊 Available Medicines", 
        "Select a medicine to add to cart:",
        sections
      );
      
      await sendInteractiveMessage(from, "Category Options", "What would you like to do next?", [
        { id: "browse_categories", title: "Change Category" },
        { id: "search_medicines", title: "Search Medicines" },
        { id: "main_menu", title: "Main Menu" }
      ]);
      return;
    }

    // Handle medicine selection
    if (messageText.startsWith('med_') || 
        (message.interactive?.list_reply?.id && message.interactive.list_reply.id.startsWith('med_'))) {
      // Extract medicine ID from either direct message or interactive message
      const medicineId = messageText.startsWith('med_') 
        ? messageText.replace('med_', '')
        : message.interactive.list_reply.id.replace('med_', '');
        
      const medicine = await getMedicineById(medicineId);
      
      if (!medicine) {
        await sendTextMessage(from, "Sorry, medicine not found.");
        return;
      }
      
      // Initialize cart if it doesn't exist
      if (!session.context_data.cart) {
        session.context_data.cart = [];
      }
      
      // Add medicine to cart
      const existingItemIndex = session.context_data.cart.findIndex(item => item.medicine_id === medicineId);
      
      if (existingItemIndex >= 0) {
        // Update quantity if already in cart
        session.context_data.cart[existingItemIndex].quantity += 1;
      } else {
        // Add new item to cart
        session.context_data.cart.push({
          medicine_id: medicineId,
          name: medicine.name,
          price: medicine.mrp,
          quantity: 1,
          requires_prescription: medicine.prescription_type === 'RX'
        });
      }
      
      await updateUserSession(from, {
        current_step: 'browse_medicines',
        context_data: session.context_data
      });
      
      // Show cart options
      await sendInteractiveMessage(from, "🛒 Cart Updated", 
        `✅ Added *${medicine.name}* to your cart.\n\n` +
        `What would you like to do next?`,
        [
          { id: "view_cart", title: "🛒 View Cart" },
          { id: "browse_categories", title: "Continue Shopping" },
          { id: "checkout", title: "Proceed to Checkout" }
        ]
      );
      return;
    }
    
    // Handle view cart - both direct command and interactive button
    if (messageText === 'view cart' || 
        (message.interactive?.button_reply?.id && message.interactive.button_reply.id === 'view_cart')) {
      const cart = session.context_data.cart || [];
      
      if (cart.length === 0) {
        await sendTextMessage(from, "Your cart is empty. Start adding some medicines!");
        await sendInteractiveMessage(from, "What would you like to do?", "", [
          { id: "browse_categories", title: "Browse Categories" },
          { id: "search_medicines", title: "Search Medicines" },
          { id: "main_menu", title: "Main Menu" }
        ]);
        return;
      }
      
      // Calculate totals
      let total = 0;
      let cartMessage = "🛒 *Your Cart*\n\n";
      
      cart.forEach((item, index) => {
        const itemTotal = item.price * item.quantity;
        total += itemTotal;
        cartMessage += `${index + 1}. ${item.name} x${item.quantity} = ₹${itemTotal.toFixed(2)}\n`;
      });
      
      cartMessage += `\n💵 *Total: ₹${total.toFixed(2)}*`;
      
      await sendTextMessage(from, cartMessage);
      
      // Check if any items require prescription
      const requiresPrescription = cart.some(item => item.requires_prescription);
      
      if (requiresPrescription) {
        await sendTextMessage(from, 
          "📋 Some items in your cart require a prescription. " +
          "Please upload a clear photo of your prescription when checking out."
        );
      }
      
      // Show cart options
      const buttons = [
        { id: "checkout", title: "✅ Checkout" },
        { id: "clear_cart", title: "🗑️ Clear Cart" },
        { id: "browse_categories", title: "🛍️ Continue Shopping" }
      ];
      
      await sendInteractiveMessage(from, "Cart Options", "What would you like to do next?", buttons);
      return;
    }
    
    // Handle checkout - both direct command and interactive button
    if (messageText === 'checkout' || 
        (message.interactive?.button_reply?.id && message.interactive.button_reply.id === 'checkout')) {
      const cart = session.context_data.cart || [];
      
      if (cart.length === 0) {
        await sendTextMessage(from, "Your cart is empty. Add some medicines first!");
        return;
      }
      
      // Check if any items require prescription
      const requiresPrescription = cart.some(item => item.requires_prescription);
      
      if (requiresPrescription) {
        // Store cart in session and ask for prescription
        await updateUserSession(from, {
          current_step: 'awaiting_prescription_checkout',
          context_data: {
            ...session.context_data,
            checkout_in_progress: true
          }
        });
        
        await sendTextMessage(from, 
          "📋 Some items in your cart require a prescription. " +
          "Please upload a clear photo of your prescription to proceed with checkout."
        );
        return;
      } else {
        // Proceed to delivery details
        await handleDeliveryDetails(from, session);
      }
      return;
    }
    
    // Handle clear cart - both direct command and interactive button
    if (messageText === 'clear_cart' || 
        (message.interactive?.button_reply?.id && message.interactive.button_reply.id === 'clear_cart')) {
      await updateUserSession(from, {
        current_step: 'browse_medicines',
        context_data: {
          ...session.context_data,
          cart: []
        }
      });
      
      await sendTextMessage(from, "🛒 Your cart has been cleared.");
      await sendInteractiveMessage(from, "What would you like to do?", "", [
        { id: "browse_categories", title: "Browse Categories" },
        { id: "search_medicines", title: "Search Medicines" },
        { id: "main_menu", title: "Main Menu" }
      ]);
      return;
    }
    
    // Handle delivery details input
    if (session.current_step === 'awaiting_delivery_details' && messageText !== 'cancel_checkout') {
      // Process delivery details
      const details = messageText.split('\n').map(line => line.trim()).filter(line => line);
      
      if (details.length < 3) {
        await sendTextMessage(from, 
          "❌ Please provide all required details in the correct format.\n\n" +
          "*Example:*\n" +
          "John Doe\n" +
          "123 Main Street, Apartment 4B\n" +
          "New Delhi\n" +
          "110001\n" +
          "Near Central Park (optional)\n\n" +
          "Please include at least your name, address, city, and pincode."
        );
        return;
      }
      
      // Extract name (first line)
      const name = details[0].replace(/^\d+\.\s*/, '');
      
      // Initialize variables
      let pincode = '';
      let city = '';
      let addressLines = [];
      let landmark = '';
      
      // Try to find pincode (6-digit number) in the message
      const pincodeMatch = messageText.match(/\b(\d{6})\b/);
      if (pincodeMatch) {
        pincode = pincodeMatch[1];
        
        // Remove pincode from the message for further processing
        const messageWithoutPincode = messageText.replace(pincode, '');
        const detailsWithoutPincode = messageWithoutPincode.split('\n').map(line => line.trim()).filter(line => line);
        
        // The first line is the name
        // The rest are address lines, city, and landmark
        if (detailsWithoutPincode.length >= 3) {
          // First line is name (already captured)
          // Next lines are address lines and city
          city = detailsWithoutPincode[detailsWithoutPincode.length - 2]; // Second last line is city
          addressLines = detailsWithoutPincode.slice(1, -2); // All lines between name and city are address
          landmark = detailsWithoutPincode[detailsWithoutPincode.length - 1]; // Last line is landmark (optional)
        } else {
          // Fallback if we can't parse properly
          city = detailsWithoutPincode[1] || '';
          addressLines = detailsWithoutPincode.slice(2);
        }
      } else {
        // If no pincode found, use the last line as city and the rest as address
        city = details[details.length - 1];
        addressLines = details.slice(1, -1);
      }
      
      // Validate required fields
      if (!pincode || !city || addressLines.length === 0) {
        await sendTextMessage(from, 
          "❌ Please provide a complete address including:\n" +
          "- Full name\n" +
          "- Complete address\n" +
          "- City\n" +
          "- 6-digit pincode\n" +
          "- Landmark (optional)\n\n" +
          "*Example:*\n" +
          "John Doe\n" +
          "123 Main Street, Apartment 4B\n" +
          "New Delhi\n" +
          "110001\n" +
          "Near Central Park"
        );
        return;
      }
      
      // Log the parsed address for debugging
      console.log('Parsed address details:', {
        name,
        address: addressLines.join(', '),
        city,
        pincode,
        landmark
      });
      
      try {
        // Update customer with address
        const customer = await getOrCreateCustomer(from, {
          name: name,
          address: addressLines.join(', '),
          city: city,
          pincode: pincode,
          landmark: landmark
        });
        
        console.log('Customer updated successfully:', customer);
        
        // Proceed with order creation
        await handleCheckoutWithPrescription(from, session, null);
        
      } catch (error) {
        console.error('Error updating customer address:', error);
        await sendTextMessage(from, 
          "❌ Failed to save your address. Please try again or contact support if the problem persists."
        );
      }
      return;
    }
    
    // Handle checkout cancellation
    if (messageText === 'cancel_checkout') {
      await updateUserSession(from, {
        current_step: 'browse_medicines',
        context_data: { cart: [] }
      });
      
      await sendTextMessage(from, "❌ Checkout cancelled. Your cart has been cleared.");
      await sendInteractiveMessage(from, "What would you like to do?", "", [
        { id: "browse_categories", title: "Browse Categories" },
        { id: "search_medicines", title: "Search Medicines" },
        { id: "main_menu", title: "Main Menu" }
      ]);
      return;
    }

    // Remove any duplicate function definitions that might exist
    // Handle Search Medicines
    if (messageText === 'search medicines') {
      await updateUserSession(from, {
        current_step: 'awaiting_search_query',
        context_data: {}
      });
      
      await sendTextMessage(from, 
        "🔍 What medicine are you looking for?\n\n" +
        "Type the name of the medicine you want to search for."
      );
      return;
    }

    // Handle search query
    if (session.current_step === 'awaiting_search_query') {
      const searchQuery = message.text?.body?.trim();
      
      if (!searchQuery) {
        await sendTextMessage(from, "Please enter a medicine name to search.");
        return;
      }
      
      const searchResults = await searchMedicines(searchQuery, 10);
      
      if (searchResults.length === 0) {
        await sendTextMessage(from, 
          `No medicines found for "${searchQuery}". Please try a different search term.`
        );
        await sendInteractiveMessage(from, "Search Options", "What would you like to do?", [
          { id: "search_medicines", title: "Search Again" },
          { id: "browse_categories", title: "Browse Categories" },
          { id: "main_menu", title: "Main Menu" }
        ]);
        return;
      }
      
      await updateUserSession(from, {
        current_step: 'browse_medicines',
        context_data: { search_query: searchQuery }
      });
      
      const sections = [{
        title: "Search Results",
        rows: searchResults.map(medicine => ({
          id: `med_${medicine.id}`,
          title: medicine.name,
          description: `₹${medicine.mrp} ${medicine.prescription_type === 'RX' ? '(Rx Required)' : ''}`
        }))
      }];
      
      await sendListMessage(from, 
        `🔍 Search Results for "${searchQuery}"`, 
        "Select a medicine to add to cart:",
        sections
      );
      return;
    }

    // Handle Track Orders - match both 'track order' and 'track_order' for better UX
    if (messageText === 'track order' || messageText === 'track_order' || 
        (message.interactive?.button_reply?.id === 'track_order')) {
      // Show loading message
      await sendTextMessage(from, "🔍 Fetching your orders...");
      
      const orders = await getUserOrders(from);
      console.log('Orders for tracking:', orders);
      
      if (!orders || orders.length === 0) {
        await sendTextMessage(from, 
          "📦 No orders found for your number.\n\n" +
          "Would you like to place an order?"
        );
        await sendInteractiveMessage(from, "Start Order", "Place your first order:", [
          { id: "browse_categories", title: "Browse Categories" },
          { id: "search_medicines", title: "Search Medicines" },
          { id: "main_menu", title: "Main Menu" }
        ]);
        return;
      }
      
      let orderText = "📦 *Your Recent Orders*\n\n";
      orders.slice(0, 5).forEach((order, index) => {
        const orderDate = order.created_at ? new Date(order.created_at) : new Date();
        const formattedDate = orderDate.toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        });
        
        orderText += `*${index + 1}. Order #${order.order_id || 'N/A'}*\n`;
        orderText += `   Status: *${order.status ? order.status.toUpperCase() : 'PROCESSING'}*\n`;
        orderText += `   Total: *₹${order.total_amount || '0.00'}*\n`;
        orderText += `   Date: ${formattedDate}\n\n`;
      });
      
      await sendTextMessage(from, orderText);
      await sendInteractiveMessage(from, "Order Options", "What would you like to do?", [
        { id: "browse_categories", title: "🛍️ Shop Again" },
        { id: "view_cart", title: "🛒 View Cart" },
        { id: "main_menu", title: "🏠 Main Menu" }
      ]);
      return;
    }

    // Handle Find Pharmacy
    if (messageText === 'find pharmacy') {
      await updateUserSession(from, {
        current_step: 'awaiting_location',
        context_data: {}
      });
      
      await sendTextMessage(from, 
        "📍 Please share your location details:\n\n" +
        "Type your city name or pincode to find nearby pharmacies."
      );
      return;
    }

    // Handle location for pharmacy search
    if (session.current_step === 'awaiting_location') {
      const location = message.text?.body?.trim();
      
      if (!location) {
        await sendTextMessage(from, "Please enter your city name or pincode.");
        return;
      }
      
      // Try to determine if it's a pincode (numeric) or city name
      const isNumeric = /^\d+$/.test(location);
      const pharmacies = await getNearbyPharmacies(
        isNumeric ? null : location,
        isNumeric ? location : null
      );
      
      if (pharmacies.length === 0) {
        await sendTextMessage(from, 
          `No pharmacies found near "${location}". Please try a different location.`
        );
        await sendInteractiveMessage(from, "Location Options", "What would you like to do?", [
          { id: "find_pharmacy", title: "Try Another Location" },
          { id: "main_menu", title: "Main Menu" }
        ]);
        return;
      }
      
      let pharmacyText = `🏥 *Pharmacies near "${location}"*:\n\n`;
      pharmacies.slice(0, 5).forEach((pharmacy, index) => {
        pharmacyText += `*${index + 1}. ${pharmacy.name}*\n`;
        pharmacyText += `   📍 ${pharmacy.address}\n`;
        pharmacyText += `   📞 ${pharmacy.phone}\n`;
        if (pharmacy.is_24x7) pharmacyText += `   🕐 Open 24x7\n`;
        pharmacyText += `\n`;
      });
      
      await sendTextMessage(from, pharmacyText);
      await sendInteractiveMessage(from, "Pharmacy Options", "What would you like to do?", [
        { id: "browse_categories", title: "Browse Medicines" },
        { id: "find_pharmacy", title: "Find Another Location" },
        { id: "main_menu", title: "Main Menu" }
      ]);
      return;
    }

    // Handle Upload Prescription
    if (messageText === 'upload prescription') {
      await updateUserSession(from, { 
        current_step: 'awaiting_prescription_upload',
        context_data: {}
      });
      
      await sendTextMessage(from, 
        "📄 Please upload a clear photo of your prescription.\n\n" +
        "Make sure the prescription is:\n" +
        "• Clearly readable\n" +
        "• From a licensed doctor\n" +
        "• Not expired\n\n" +
        "After uploading, our pharmacist will review and contact you."
      );
      return;
    }

    // Default response for unrecognized input
    await sendTextMessage(from, 
      "I didn't understand that. Please select an option from the menu or type 'hi' to start over."
    );
    
    // Send main menu
    setTimeout(async () => {
      await handleIncomingMessage(from, { text: { body: 'hi' } });
    }, 1000);

  } catch (error) {
    console.error('Error handling message:', error);
    await sendTextMessage(from, 
      "Sorry, something went wrong. Please try again or contact support."
    );
  }
};

// Webhook endpoints (unchanged)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
      console.log('Webhook verified');
      res.status(200).send(challenge);
      return;
    }
  }
  res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    if (body.object === 'whatsapp_business_account') {
      body.entry?.forEach(async (entry) => {
        const changes = entry.changes;
        
        changes?.forEach(async (change) => {
          if (change.field === 'messages') {
            const messages = change.value.messages;
            
            if (messages) {
              for (const message of messages) {
                const from = message.from;
                console.log(`Received message from ${from}:`, message);
                
                await handleIncomingMessage(from, message);
              }
            }
          }
        });
      });
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Error');
  }
});

// API endpoints for testing
app.get('/api/test-connection', async (req, res) => {
  try {
    const categories = await getCategories();
    res.json({ 
      status: 'Connected to Django backend',
      categories_count: categories.length,
      backend_url: DJANGO_BASE_URL
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'Failed to connect to Django backend',
      error: error.message,
      backend_url: DJANGO_BASE_URL
    });
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Test Django backend connection
    const categories = await getCategories();
    
    res.json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      backend_connection: 'Connected',
      backend_url: DJANGO_BASE_URL,
      categories_available: categories.length
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({ 
      status: 'ERROR', 
      timestamp: new Date().toISOString(),
      backend_connection: 'Failed',
      backend_url: DJANGO_BASE_URL,
      error: error.message
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 WhatsApp Pharmacy Bot server running on port ${PORT}`);
  console.log(`🔗 Django Backend URL: ${DJANGO_BASE_URL}`);
  console.log('📱 Webhook URL: https://your-domain.com/webhook');
  console.log('🔧 Make sure to set your environment variables:');
  console.log('   - WHATSAPP_TOKEN');
  console.log('   - WHATSAPP_PHONE_NUMBER_ID'); 
  console.log('   - WEBHOOK_VERIFY_TOKEN');
  console.log('   - DJANGO_BASE_URL');
});

module.exports = app;