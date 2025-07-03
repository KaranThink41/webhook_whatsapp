// Session management with Django backend
const { apiRequest } = require('../utils/api');

const getUserSession = async (phoneNumber) => {
  try {
    console.log(`Getting session for ${phoneNumber}`);
    const session = await apiRequest(`/api/whatsapp-session/${phoneNumber}/`);
    return session;
  } catch (error) {
    if (error.response?.status === 404) {
      // Create new session if not found
      const newSession = await apiRequest(`/api/whatsapp-session/${phoneNumber}/`, 'POST', {
        current_step: 'start',
        context_data: {}
      });
      return newSession;
    }
    console.error('Error in getUserSession:', error.response?.data || error.message);
    throw error;
  }
};

const updateUserSession = async (phoneNumber, updates) => {
  try {
    console.log(`Updating session for ${phoneNumber}`, updates);
    const session = await apiRequest(`/api/whatsapp-session/${phoneNumber}/`, 'PATCH', updates);
    return session;
  } catch (error) {
    console.error('Error updating session:', error.response?.data || error.message);
    throw error;
  }
};

module.exports = {
  getUserSession,
  updateUserSession
};
