// server.js - Main application entry point
const express = require('express');
const multer = require('multer');
const FormData = require('form-data');
const axios = require('axios');
const { 
  WHATSAPP_TOKEN, 
  WHATSAPP_PHONE_NUMBER_ID, 
  WEBHOOK_VERIFY_TOKEN, 
  DJANGO_BASE_URL, 
  WHATSAPP_API_URL 
} = require('./modules/config');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Import API utilities
const { apiRequest } = require('./utils/api');

// Make apiRequest available globally for other modules
global.apiRequest = apiRequest;

// Import session management
const { getUserSession, updateUserSession } = require('./modules/session');

// Import modules
const {
  getCategories,
  getMedicinesByCategory,
  searchMedicines,
  getMedicineById,
  handleBrowseCategories,
  handleCategorySelection,
  handleMedicineSearch,
  handleMedicineSelection,
  handleViewCart,
  handleAddToCart,
  handleClearCart,
  handleCheckout
} = require('./modules/medicine');

const {
  getUserOrders,
  createQuickOrder,
  handleCheckoutWithPrescription,
  handleDeliveryDetails,
  handleOrderCompletion,
  handleTrackOrder
} = require('./modules/orders');

const {
  getNearbyPharmacies,
  uploadPrescription,
  handleFindPharmacy,
  handlePharmacyLocation,
  handleLocationInput
} = require('./modules/pharmacy');

const {
  sendWhatsAppMessage,
  sendTextMessage,
  sendInteractiveMessage,
  sendListMessage,
  downloadWhatsAppMedia
} = require('./modules/whatsapp');

const { getOrCreateCustomer } = require('./modules/customer');



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
        
        await handleOrderCompletion(from, session, orderItems);
      }
      
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

    // Handle Browse Categories - both direct command and interactive button
    if (messageText === 'browse categories' || 
        (message.interactive?.button_reply?.id && message.interactive.button_reply.id === 'browse_categories')) {
      await handleBrowseCategories(from);
      return;
    }

    // Handle category selection
    if (message.interactive?.list_reply?.id?.startsWith('cat_')) {
      await handleCategorySelection(from, message);
      return;
    }

    // Handle medicine selection
    if (messageText.startsWith('med_') || 
        (message.interactive?.list_reply?.id && message.interactive.list_reply.id.startsWith('med_'))) {
      await handleMedicineSelection(from, message, session);
      return;
    }
    
    // Handle view cart - both direct command and interactive button
    if (messageText === 'view cart' || 
        (message.interactive?.button_reply?.id && message.interactive.button_reply.id === 'view_cart')) {
      await handleViewCart(from, session);
      return;
    }
    
    // Handle checkout - both direct command and interactive button
    if (messageText === 'checkout' || 
        (message.interactive?.button_reply?.id && message.interactive.button_reply.id === 'checkout')) {
      await handleCheckout(from, session);
      return;
    }
    
    // Handle clear cart - both direct command and interactive button
    if (messageText === 'clear_cart' || 
        (message.interactive?.button_reply?.id && message.interactive.button_reply.id === 'clear_cart')) {
      await handleClearCart(from);
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
          "400001\n" +
          "Near Central Park (optional)\n\n" +
          "Please include at least your name, address, and pincode."
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
      
      // Try to find pincode (5 or 6-digit number) in the message
      const pincodeMatch = messageText.match(/\b(\d{5,6})\b/);
      if (pincodeMatch) {
        pincode = pincodeMatch[1];
      }
      
      // Process address lines
      if (details.length >= 3) {
        // First try to find pincode in any line
        for (let i = 1; i < details.length; i++) {
          const pincodeMatch = details[i].match(/^(\d{5,6})$/);
          if (pincodeMatch) {
            pincode = pincodeMatch[1];
            // If pincode is not the last line, the line before it is likely the city
            if (i > 1) {
              city = details[i-1];
              // Everything before city is address line 1
              addressLines = [details[1]];
              // Everything between city and pincode is address line 2
              if (i > 2) {
                addressLines = addressLines.concat(details.slice(2, i-1));
              }
              // Everything after pincode is landmark
              if (i < details.length - 1) {
                landmark = details.slice(i+1).join(', ');
              }
            } else {
              // Pincode is the second line, so first line is name, second is pincode
              addressLines = [];
              city = details[1];
              if (details.length > 2) {
                landmark = details.slice(2).join(', ');
              }
            }
            break;
          }
        }
        
        // If we didn't find a pincode, make some reasonable assumptions
        if (!pincode) {
          // Second last line is city, last line is landmark
          city = details[details.length - 2] || '';
          addressLines = details.slice(1, -2);
          landmark = details[details.length - 1] || '';
        }
      } else if (details.length === 2) {
        // Only name and one other line - assume it's the address
        addressLines = [details[1]];
        // Try to extract pincode if it's in the address
        const pincodeMatch = details[1].match(/(\d{5,6})/);
        if (pincodeMatch) {
          pincode = pincodeMatch[1];
          city = details[1].replace(pincode, '').replace(/[^\w\s]/g, '').trim();
        }
      }
      
      // Validate required fields - only name, address and pincode are mandatory
      if (!name || addressLines.length === 0 || !pincode) {
        await sendTextMessage(from, 
          "❌ Please provide a complete address including:\n" +
          "- Full name\n" +
          "- Complete address\n" +
          "- Pincode (5 or 6 digits)\n" +
          "- Landmark (optional)\n\n" +
          "*Example:*\n" +
          "John Doe\n" +
          "123 Main Street, Apartment 4B\n" +
          "400001\n" +
          "Near Central Park"
        );
        return;
      }
      
      // Log the parsed address for debugging
      console.log('Parsed address details:', {
        name,
        address: addressLines.join(', '),
        pincode,
        landmark
      });
      
      try {
        // Clean up the city name (remove any trailing numbers or special chars)
        const cleanCity = city ? city.replace(/[^a-zA-Z\s]/g, '').trim() : '';
        
        // Make sure we have required fields
        if (!pincode) {
          await sendTextMessage(from, 
            "❌ Could not find a valid pincode in your address. " +
            "Please include a 5 or 6 digit pincode in your address."
          );
          return;
        }
        
        // Update customer with address
        const customer = await getOrCreateCustomer(from, {
          name: name,
          address: addressLines.join(', '),
          city: cleanCity,
          pincode: pincode,
          landmark: landmark
        });
        
        console.log('Updated customer with address:', {
          name,
          address: addressLines.join(', '),
          city: cleanCity,
          pincode,
          landmark
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
      await handleTrackOrder(from);
      return;
    }

    // Handle Find Pharmacy
    if (messageText === 'find pharmacy') {
      await handleFindPharmacy(from);
      return;
    }

    // Handle location for pharmacy search
    if (session.current_step === 'awaiting_location') {
      await handleLocationInput(from, message);
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

    // Handle Add to Cart button click
    if (message.interactive?.button_reply?.id?.startsWith('add_')) {
      const medicineId = message.interactive.button_reply.id.replace('add_', '');
      try {
        const medicine = await getMedicineById(medicineId);
        if (medicine) {
          await handleAddToCart(from, medicine, session);
          return;
        } else {
          console.error(`Medicine not found with ID: ${medicineId}`);
          await sendTextMessage(from, "❌ Sorry, we couldn't find that medicine. Please try again.");
        }
      } catch (error) {
        console.error('Error adding to cart:', error);
        await sendTextMessage(from, "❌ Sorry, there was an error adding the item to your cart. Please try again.");
      }
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