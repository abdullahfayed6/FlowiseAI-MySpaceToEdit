import express from 'express'
import whatsappController from '../../controllers/whatsapp'

const router = express.Router()

// Devices
router.get('/devices', whatsappController.getDevices)
router.post('/devices', whatsappController.addDevice)
router.delete('/devices/:id', whatsappController.deleteDevice)
router.get('/devices/:id/qr', whatsappController.getDeviceQR)

// Chatbots
router.get('/chatbots', whatsappController.getChatbots)
router.post('/chatbots', whatsappController.addChatbot)
router.put('/chatbots/:id', whatsappController.updateChatbot)
router.delete('/chatbots/:id', whatsappController.deleteChatbot)

// Inbox routes
router.get('/devices/:deviceId/chats', whatsappController.getChats)
router.get('/devices/:deviceId/chats/:chatId/messages', whatsappController.getMessages)
router.post('/devices/:deviceId/chats/:chatId/messages', whatsappController.sendMessage)
router.post('/devices/:deviceId/chats/:chatId/toggle-ai', whatsappController.toggleChatAI)
router.delete('/devices/:deviceId/chats/:chatId', whatsappController.deleteChat)

export default router
