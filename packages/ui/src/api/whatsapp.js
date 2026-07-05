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
    sendMessage: (deviceId, chatId, text) => client.post(`/whatsapp/devices/${deviceId}/chats/${chatId}/messages`, { text }),
    deleteChat: (deviceId, chatId) => client.delete(`/whatsapp/devices/${deviceId}/chats/${chatId}`)
}
