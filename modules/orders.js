// orders.js - Order related functions

const { getNearbyPharmacies } = require('./pharmacy');
const { getOrCreateCustomer } = require('./customer');
const { 
  sendTextMessage, 
  sendInteractiveMessage,
  sendListMessage
} = require('./whatsapp');
const { updateUserSession } = require('./session');
const { apiRequest } = require('../utils/api');

// Order management
const getUserOrders = async (phoneNumber) => {
  try {
    console.log(`Fetching orders for phone: ${phoneNumber}`);
    const orders = await apiRequest(`/api/orders/customer/${phoneNumber}/`);
    console.log('Fetched orders:', JSON.stringify(orders, null, 2));
    return Array.isArray(orders) ? orders : [];
  } catch (error) {
    console.error('Error fetching user orders:', error);
    if (error.response) {
      console.error('Error response:', {
        status: error.response.status,
        data: error.response.data,
        headers: error.response.headers
      });
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
    const order = await apiRequest('/api/orders/quick-create/', 'POST', orderData);
    return order;
  } catch (error) {
    console.error('Error creating order:', error);
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
        city: customer.city,
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
  try {
    // First, ensure we have a valid cart
    if (!session.context_data.cart || session.context_data.cart.length === 0) {
      await sendTextMessage(phoneNumber, "❌ Your cart is empty. Please add items before checkout.");
      return;
    }

    // Update session to await delivery details
    const updatedSession = {
      ...session,
      current_step: 'awaiting_delivery_details',
      context_data: {
        ...session.context_data,
        checkout_in_progress: true
      }
    };
    
    await updateUserSession(phoneNumber, updatedSession);
    
    // Send delivery instructions
    await sendTextMessage(phoneNumber,
      "🚚 *Delivery Details*\n\n" +
      "Please provide your delivery details in the following format:\n\n" +
      "1. Full Name\n" +
      "2. Complete Address\n" +
      "3. Pincode\n" +
      "4. Landmark (Optional)\n\n" +
      "*Example:*\n" +
      "John Doe\n" +
      "123 Main St, Apartment 4B\n" +
      "New Delhi\n" +
      "110001\n" +
      "Near City Mall"
    );
    
    // Add cancel option
    await sendInteractiveMessage(phoneNumber, "Delivery Details", "You can also:", [
      { id: "cancel_checkout", title: "❌ Cancel Checkout" }
    ]);
    
  } catch (error) {
    console.error('Error in handleDeliveryDetails:', error);
    await sendTextMessage(phoneNumber, "❌ An error occurred. Please try again.");
    
    // Reset to browse mode on error
    await updateUserSession(phoneNumber, {
      current_step: 'browse_medicines',
      context_data: { ...session.context_data, checkout_in_progress: false }
    });
  }
}

// Handle order tracking
const handleTrackOrder = async (from) => {
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
    orderText += `📅 ${formattedDate}\n`;
    orderText += `🏪 Pharmacy: ${order.pharmacy?.name || 'N/A'}\n`;
    orderText += `💰 Total: ₹${order.total_amount || '0.00'}\n`;
    orderText += `📦 Status: ${order.status || 'Processing'}\n\n`;
  });
  
  await sendTextMessage(from, orderText);
  
  // Show options for next steps
  await sendInteractiveMessage(from, "Next Steps", "What would you like to do next?", [
    { id: "browse_categories", title: "Browse Categories" },
    { id: "track_order", title: "Refresh Orders" },
    { id: "main_menu", title: "Main Menu" }
  ]);
};

const handleOrderCompletion = async (from, session, orderItems) => {
  const order = await createQuickOrder(from, orderItems);
  
  // Update session
  await updateUserSession(from, {
    current_step: 'browse_medicines',
    context_data: {}
  });
  
  await sendTextMessage(from, 
    `✅ Order placed successfully!\n\n` +
    `📋 Order ID: ${order.order_id}\n` +
    `💰 Total: ₹${order.total_amount}\n\n` +
    `Your order will be processed within 2 hours.`
  );
  
  await sendInteractiveMessage(from, "Next Action", "What would you like to do?", [
    { id: "browse_categories", title: "Browse Categories" },
    { id: "track_order", title: "Track Orders" },
    { id: "main_menu", title: "Main Menu" }
  ]);
  
  return order;
};

module.exports = {
  getUserOrders,
  createQuickOrder,
  handleCheckoutWithPrescription,
  handleDeliveryDetails,
  handleOrderCompletion,
  handleTrackOrder
};
