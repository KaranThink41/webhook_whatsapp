// server.js - Pharmacy related functions section

// Pharmacy functions
const { DJANGO_BASE_URL } = require('./config');
const { apiRequest } = require('../utils/api');
const { 
  sendTextMessage, 
  sendInteractiveMessage,
  sendListMessage
} = require('./whatsapp');
const { updateUserSession } = require('./session');

const getNearbyPharmacies = async (city = null, pincode = null) => {
  try {
    const params = new URLSearchParams();
    if (city) params.append('city', city);
    if (pincode) params.append('pincode', pincode);
    
    const response = await apiRequest(`/api/pharmacies/nearby/?${params.toString()}`);
    return response;
  } catch (error) {
    console.error('Error fetching pharmacies:', error);
    
    // For testing - return a test pharmacy if none found
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
      console.log('Returning test pharmacy for development');
      return [{
        id: 'test-pharmacy-1',
        name: 'Test Pharmacy',
        address: '123 Test St, Test City',
        phone: '+1234567890',
        pincodes: ['110001', '110002', '110003'],
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

// Handle Find Pharmacy
async function handleFindPharmacy(from) {
  await updateUserSession(from, {
    current_step: 'awaiting_location',
    context_data: {}
  });
  
  await sendTextMessage(from, 
    "📍 Please share your location details:\n\n" +
    "Type your city name or pincode to find nearby pharmacies."
  );
}

// Handle location for pharmacy search
async function handlePharmacyLocation(from, message) {
  try {
    // Check if the message contains a location (from WhatsApp location button)
    if (message.location) {
      // Handle GPS location
      const { latitude, longitude } = message.location;
      // In a real implementation, you would use these coordinates to find nearby pharmacies
      // For now, we'll just acknowledge the location
      await sendTextMessage(from, `Location received! Looking for pharmacies near you...`);
      // Simulate finding pharmacies
      const pharmacies = await getNearbyPharmacies();
      
      // Show pharmacy list UI
      await showPharmacyListUI(from, pharmacies, "your location");
    } else {
      // Handle text-based location (city name or pincode)
      const location = message.text.trim();
      await sendTextMessage(from, `Searching for pharmacies near "${location}"...`);
      
      // Get pharmacies based on location
      const pharmacies = await getNearbyPharmacies(location, /^\d+$/.test(location) ? location : null);
      
      // Show pharmacy list UI
      await showPharmacyListUI(from, pharmacies, location);
      
      // Update session to show we're done with location input
      await updateUserSession(from, { current_step: 'browse_medicines' });
    }
  } catch (error) {
    console.error('Error handling pharmacy location:', error);
    await sendTextMessage(from, 'Sorry, there was an error finding pharmacies. Please try again later.');
  }
}

// Show pharmacy list UI
async function showPharmacyListUI(from, pharmacies, location) {
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
}

// Handle Find Pharmacy command
async function handleFindPharmacy(from) {
  await updateUserSession(from, {
    current_step: 'awaiting_location',
    context_data: {}
  });
  
  await sendTextMessage(from, 
    "📍 Please share your location details:\n\n" +
    "Type your city name or pincode to find nearby pharmacies."
  );
}

// Handle location input for pharmacy search
async function handleLocationInput(from, message) {
  const location = message.text?.body?.trim();
  
  if (!location) {
    await sendTextMessage(from, "Please enter your city name or pincode.");
    return;
  }
  
  // Handle pharmacy location search
  await handlePharmacyLocation(from, { text: location });
}

module.exports = {
  getNearbyPharmacies,
  uploadPrescription,
  handleFindPharmacy,
  handlePharmacyLocation,
  handleLocationInput
};
