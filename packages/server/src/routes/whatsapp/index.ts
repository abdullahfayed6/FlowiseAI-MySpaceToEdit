import express from 'express'
import whatsappController from '../../controllers/whatsapp'
import { checkPermission } from '../../enterprise/rbac/PermissionCheck'

const router = express.Router()

// Devices
router.get('/devices', checkPermission('whatsapp-devices:view'), whatsappController.getDevices)
router.post('/devices', checkPermission('whatsapp-devices:view'), whatsappController.addDevice)
router.delete('/devices/:id', checkPermission('whatsapp-devices:view'), whatsappController.deleteDevice)
router.get('/devices/:id/qr', checkPermission('whatsapp-devices:view'), whatsappController.getDeviceQR)
router.get('/devices/:deviceId/groups', checkPermission('whatsapp-devices:view'), whatsappController.getDeviceGroups)
router.get(
    '/devices/:deviceId/groups/:groupId/participants',
    checkPermission('whatsapp-devices:view'),
    whatsappController.getGroupParticipants
)

// Chatbots
router.get('/chatbots', checkPermission('whatsapp-chatbots:view'), whatsappController.getChatbots)
router.post('/chatbots', checkPermission('whatsapp-chatbots:view'), whatsappController.addChatbot)
router.put('/chatbots/:id', checkPermission('whatsapp-chatbots:view'), whatsappController.updateChatbot)
router.delete('/chatbots/:id', checkPermission('whatsapp-chatbots:view'), whatsappController.deleteChatbot)

// Campaigns
router.get('/campaigns', checkPermission('whatsapp-campaigns:view'), whatsappController.getCampaigns)
router.post('/campaigns', checkPermission('whatsapp-campaigns:view'), whatsappController.createCampaign)
router.get('/campaigns/:id', checkPermission('whatsapp-campaigns:view'), whatsappController.getCampaign)
router.post('/campaigns/:id/start', checkPermission('whatsapp-campaigns:view'), whatsappController.startCampaign)
router.post('/campaigns/:id/pause', checkPermission('whatsapp-campaigns:view'), whatsappController.pauseCampaign)
router.delete('/campaigns/:id', checkPermission('whatsapp-campaigns:view'), whatsappController.deleteCampaign)

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
