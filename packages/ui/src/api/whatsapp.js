import client from './client'

const getDevices = () => client.get('/whatsapp/devices')
const addDevice = (body) => client.post('/whatsapp/devices', body)
const deleteDevice = (id) => client.delete(`/whatsapp/devices/${id}`)
const getDeviceQR = (id) => client.get(`/whatsapp/devices/${id}/qr`)

const getChatbots = () => client.get('/whatsapp/chatbots')
const addChatbot = (body) => client.post('/whatsapp/chatbots', body)
const updateChatbot = (id, body) => client.put(`/whatsapp/chatbots/${id}`, body)
const deleteChatbot = (id) => client.delete(`/whatsapp/chatbots/${id}`)

export default {
    getDevices,
    addDevice,
    deleteDevice,
    getDeviceQR,
    getChatbots,
    addChatbot,
    updateChatbot,
    deleteChatbot,

    // Inbox
    getChats: (deviceId) => client.get(`/whatsapp/devices/${deviceId}/chats`),
    getMessages: (deviceId, chatId) => client.get(`/whatsapp/devices/${deviceId}/chats/${chatId}/messages`),
    sendMessage: (deviceId, chatId, text, file) => client.post(`/whatsapp/devices/${deviceId}/chats/${chatId}/messages`, { text, file }),
    toggleChatAI: (deviceId, chatId, isPaused) => client.post(`/whatsapp/devices/${deviceId}/chats/${chatId}/toggle-ai`, { isPaused }),
    deleteChat: (deviceId, chatId) => client.delete(`/whatsapp/devices/${deviceId}/chats/${chatId}`),
    getMessageMedia: (deviceId, chatId, messageId) =>
        client.get(`/whatsapp/devices/${deviceId}/chats/${chatId}/messages/${messageId}/media`, { responseType: 'blob' }),

    // Campaigns
    getCampaigns: () => client.get('/whatsapp/campaigns'),
    createCampaign: (body) => client.post('/whatsapp/campaigns', body),
    getCampaign: (id) => client.get(`/whatsapp/campaigns/${id}`),
    startCampaign: (id) => client.post(`/whatsapp/campaigns/${id}/start`),
    pauseCampaign: (id) => client.post(`/whatsapp/campaigns/${id}/pause`),
    deleteCampaign: (id) => client.delete(`/whatsapp/campaigns/${id}`)
}
