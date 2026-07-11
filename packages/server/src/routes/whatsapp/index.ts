import express from 'express'
import whatsappController from '../../controllers/whatsapp'
import { checkPermission } from '../../enterprise/rbac/PermissionCheck'

const router = express.Router()

// Devices
router.get('/devices', checkPermission('whatsapp-devices:view'), whatsappController.getDevices)
router.post('/devices', checkPermission('whatsapp-devices:view'), whatsappController.addDevice)
router.delete('/devices/:id', checkPermission('whatsapp-devices:view'), whatsappController.deleteDevice)
router.get('/devices/:id/qr', checkPermission('whatsapp-devices:view'), whatsappController.getDeviceQR)

// Chatbots
router.get('/chatbots', checkPermission('whatsapp-chatbots:view'), whatsappController.getChatbots)
router.post('/chatbots', checkPermission('whatsapp-chatbots:view'), whatsappController.addChatbot)
router.put('/chatbots/:id', checkPermission('whatsapp-chatbots:view'), whatsappController.updateChatbot)
router.delete('/chatbots/:id', checkPermission('whatsapp-chatbots:view'), whatsappController.deleteChatbot)

// Inbox routes
router.get('/devices/:deviceId/chats', checkPermission('whatsapp-inbox:view'), whatsappController.getChats)
router.get('/devices/:deviceId/chats/:chatId/messages', checkPermission('whatsapp-inbox:view'), whatsappController.getMessages)
router.post('/devices/:deviceId/chats/:chatId/messages', checkPermission('whatsapp-inbox:view'), whatsappController.sendMessage)
router.post('/devices/:deviceId/chats/:chatId/toggle-ai', checkPermission('whatsapp-inbox:view'), whatsappController.toggleChatAI)
router.delete('/devices/:deviceId/chats/:chatId', checkPermission('whatsapp-inbox:view'), whatsappController.deleteChat)
router.get(
    '/devices/:deviceId/chats/:chatId/messages/:messageId/media',
    checkPermission('whatsapp-inbox:view'),
    whatsappController.downloadMessageMedia
)

export default router
