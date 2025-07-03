// medicine.js - Medicine related functions

const { 
  sendTextMessage, 
  sendInteractiveMessage, 
  sendListMessage
} = require('./whatsapp');

const { updateUserSession } = require('./session');
const { getOrCreateCustomer } = require('./customer');
const { createQuickOrder, handleDeliveryDetails } = require('./orders');
const { apiRequest } = require('../utils/api');

// Medicine and catalog functions
const getCategories = async () => {
  try {
    const response = await apiRequest('/api/categories/');
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
    const response = await apiRequest(`/api/medicines/?category=${categoryId}`);
    
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

const searchMedicines = async (query, limit = 10) => {
  try {
    const medicines = await apiRequest(`/api/medicines/search/?q=${encodeURIComponent(query)}&limit=${limit}`);
    return medicines;
  } catch (error) {
    console.error('Error searching medicines:', error);
    return [];
  }
};

const getMedicineById = async (medicineId) => {
  try {
    const medicine = await apiRequest(`/api/medicines/${medicineId}/`);
    return medicine;
  } catch (error) {
    console.error('Error fetching medicine by ID:', error);
    return null;
  }
};

// Handle Browse Categories
async function handleBrowseCategories(from) {
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
}

// Handle category selection
async function handleCategorySelection(from, message) {
  const categoryId = message.interactive?.list_reply?.id?.replace('cat_', '');
  
  if (!categoryId) {
    await sendTextMessage(from, "Please select a valid category.");
    return;
  }
  
  try {
    const medicines = await getMedicinesByCategory(categoryId);
    
    if (!medicines || medicines.length === 0) {
      await sendTextMessage(from, "No medicines found in this category.");
      return;
    }
    
    await updateUserSession(from, {
      current_step: 'browse_medicines',
      context_data: { current_category: categoryId }
    });
    
    // Show medicine list
    const sections = [{
      title: "Available Medicines",
      rows: medicines.slice(0, 10).map(medicine => ({
        id: `med_${medicine.id}`,
        title: medicine.name,
        description: `₹${medicine.mrp} ${medicine.prescription_type === 'RX' ? '(Rx Required)' : ''}`
      }))
    }];
    
    await sendListMessage(
      from,
      "💊 Available Medicines",
      "Select a medicine to add to cart:",
      sections
    );
    
    // Show navigation options
    await sendInteractiveMessage(
      from,
      "Category Options",
      "What would you like to do next?",
      [
        { id: "browse_categories", title: "Change Category" },
        { id: "search_medicines", title: "Search Medicines" },
        { id: "main_menu", title: "Main Menu" }
      ]
    );
    
  } catch (error) {
    console.error('Error handling category selection:', error);
    await sendTextMessage(from, "Sorry, there was an error loading medicines. Please try again later.");
  }
}

// Handle medicine search
async function handleMedicineSearch(from, query) {
  if (!query || query.trim() === '') {
    await sendTextMessage(from, "Please enter a search term (e.g., 'Dolo 650' or 'Azithromycin')");
    return;
  }
  
  const medicines = await searchMedicines(query);
  
  if (medicines.length === 0) {
    await sendTextMessage(from, `No medicines found matching "${query}". Please try a different search term.`);
    return;
  }
  
  await updateUserSession(from, {
    current_step: 'search_results',
    context_data: { search_query: query }
  });
  
  const sections = [{
    title: "Search Results",
    rows: medicines.slice(0, 10).map(medicine => ({
      id: `med_${medicine.id}`,
      title: medicine.name || 'Unnamed Medicine',
      description: (medicine.description || `Price: ₹${medicine.price || 'N/A'}`).substring(0, 72)
    }))
  }];
  
  await sendListMessage(from, 
    "🔍 Search Results", 
    `Found ${medicines.length} medicines matching "${query}":`,
    sections
  );
}

// Handle medicine selection
async function handleMedicineSelection(from, message, session) {
  try {
    // Extract medicine ID from either direct message or interactive message
    const messageText = message.text?.body?.toLowerCase() || '';
    const medicineId = messageText.startsWith('med_') 
      ? messageText.replace('med_', '')
      : message.interactive?.list_reply?.id?.replace('med_', '');
      
    if (!medicineId) {
      await sendTextMessage(from, "Invalid medicine selection.");
      return;
    }
    
    const medicine = await getMedicineById(medicineId);
    
    if (!medicine) {
      await sendTextMessage(from, "Sorry, medicine not found.");
      return;
    }
    
    // Initialize cart if it doesn't exist
    if (!session.context_data.cart) {
      session.context_data.cart = [];
    }
    
    // Show medicine details
    const medicineDetails = `💊 *${medicine.name}*\n\n` +
      `ℹ️ ${medicine.description || 'No description available'}\n\n` +
      `💰 Price: ₹${medicine.price || 'N/A'}\n` +
      `📦 In Stock: ${medicine.stock_quantity > 0 ? 'Yes' : 'No'}\n` +
      `${medicine.prescription_type === 'RX' ? '📝 *Prescription Required*' : ''}`;
    
    await sendTextMessage(from, medicineDetails);
    
    // Show add to cart options
    await sendInteractiveMessage(from, "Add to Cart", "Would you like to add this to your cart?", [
      { id: `add_${medicine.id}`, title: "✅ Add to Cart" },
      { id: "browse_categories", title: "🔙 Back to Categories" },
      { id: "main_menu", title: "🏠 Main Menu" }
    ]);
    
  } catch (error) {
    console.error('Error handling medicine selection:', error);
    await sendTextMessage(from, "Sorry, there was an error processing your request. Please try again.");
  }
}

// Cart Management Functions
const handleViewCart = async (from, session) => {
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
};

const handleAddToCart = async (from, medicine, session) => {
  const cart = session.context_data.cart || [];
  const existingItem = cart.find(item => item.id === medicine.id);
  
  if (existingItem) {
    existingItem.quantity += 1;
  } else {
    cart.push({
      id: medicine.id,
      name: medicine.name,
      price: medicine.price,
      quantity: 1,
      requires_prescription: medicine.prescription_type === 'RX'
    });
  }
  
  await updateUserSession(from, {
    ...session,
    context_data: {
      ...session.context_data,
      cart: cart
    }
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
};

const handleClearCart = async (from) => {
  await updateUserSession(from, {
    current_step: 'browse_medicines',
    context_data: {
      cart: []
    }
  });
  
  await sendTextMessage(from, "🛒 Your cart has been cleared.");
  await sendInteractiveMessage(from, "What would you like to do?", "", [
    { id: "browse_categories", title: "Browse Categories" },
    { id: "search_medicines", title: "Search Medicines" },
    { id: "main_menu", title: "Main Menu" }
  ]);
};

const handleCheckout = async (from, session) => {
  const cart = session.context_data.cart || [];
  
  if (cart.length === 0) {
    await sendTextMessage(from, "Your cart is empty. Add some medicines first!");
    return;
  }
  
  // Update session to reflect checkout in progress
  await updateUserSession(from, {
    current_step: 'checkout_started',
    context_data: {
      ...session.context_data,
      checkout_in_progress: true
    }
  });
  
  // Check if any items require prescription
  const requiresPrescription = cart.some(item => item.requires_prescription);
  
  if (requiresPrescription) {
    // Update session for prescription upload
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
  } else {
    // Proceed to delivery details
    await handleDeliveryDetails(from, {
      ...session,
      context_data: {
        ...session.context_data,
        checkout_in_progress: true
      }
    });
  }
};

module.exports = {
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
};
