import { Request, Response, NextFunction } from 'express'
import { v4 as uuidv4 } from 'uuid'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { getDataSource } from '../../DataSource'
import { WhatsAppDevice } from '../../database/entities/WhatsAppDevice'
import { WhatsAppChatbot } from '../../database/entities/WhatsAppChatbot'
import logger from '../../utils/logger'
import { WhatsAppSessionManager } from '../../utils/WhatsAppSessionManager'

const getDevices = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const repo = getDataSource().getRepository(WhatsAppDevice)
        const devices = await repo.find({ order: { createdDate: 'DESC' } })
        return res.status(200).json(devices)
    } catch (error) {
        next(error)
    }
}

const addDevice = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { name } = req.body
        if (!name) {
            return res.status(400).json({ error: 'Device name is required' })
        }

        const repo = getDataSource().getRepository(WhatsAppDevice)
        const sessionName = `session-${uuidv4()}`

        const device = new WhatsAppDevice()
        device.name = name
        device.sessionName = sessionName
        device.status = 'INITIALIZING'

        const savedDevice = await repo.save(device)

        // Asynchronously initialize the WhatsApp client to generate the QR code
        WhatsAppSessionManager.getInstance()
            .initSession(savedDevice.id)
            .catch((err) => {
                console.error(`Error initializing WhatsApp session ${savedDevice.id}:`, err)
            })

        return res.status(201).json(savedDevice)
    } catch (error) {
        next(error)
    }
}

const deleteDevice = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params
        const repo = getDataSource().getRepository(WhatsAppDevice)
        const device = await repo.findOneBy({ id })

        if (!device) {
            return res.status(404).json({ error: 'Device not found' })
        }

        // Close and destroy the active WhatsApp Client
        await WhatsAppSessionManager.getInstance().closeSession(id)

        // Delete the session data folder on disk
        const sessionPath = path.join(os.homedir(), '.flowise', 'whatsapp_sessions', `session-${device.sessionName}`)
        if (fs.existsSync(sessionPath)) {
            try {
                fs.rmSync(sessionPath, { recursive: true, force: true })
            } catch (err) {
                console.error(`Failed to delete session directory:`, err)
            }
        }

        // Also delete any chatbot mapping linked to this device
        const chatbotRepo = getDataSource().getRepository(WhatsAppChatbot)
        await chatbotRepo.delete({ deviceId: id })

        await repo.delete({ id })

        return res.status(200).json({ message: 'Device deleted successfully' })
    } catch (error) {
        next(error)
    }
}

const getDeviceQR = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params
        const repo = getDataSource().getRepository(WhatsAppDevice)
        const device = await repo.findOneBy({ id })

        if (!device) {
            return res.status(404).json({ error: 'Device not found' })
        }

        // If disconnected, try to re-initialize
        if (device.status === 'DISCONNECTED') {
            WhatsAppSessionManager.getInstance()
                .initSession(id)
                .catch((err) => {
                    console.error(`Error re-initializing WhatsApp session ${id}:`, err)
                })
            device.status = 'INITIALIZING'
            await repo.save(device)
        }

        return res.status(200).json({
            status: device.status,
            qrCode: device.qrCode,
            phoneNumber: device.phoneNumber
        })
    } catch (error) {
        next(error)
    }
}

const getChatbots = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const repo = getDataSource().getRepository(WhatsAppChatbot)
        const chatbots = await repo.find({ order: { createdDate: 'DESC' } })
        return res.status(200).json(chatbots)
    } catch (error) {
        next(error)
    }
}

const addChatbot = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const {
            title,
            deviceId,
            chatflowId,
            isFollowUpEnabled,
            followUpDelayMinutes,
            followUpSystemPrompt,
            businessHoursEnabled,
            businessHoursStart,
            businessHoursEnd,
            outsideHoursMessage
        } = req.body
        if (!title || !deviceId || !chatflowId) {
            return res.status(400).json({ error: 'Title, deviceId, and chatflowId are required' })
        }

        const repo = getDataSource().getRepository(WhatsAppChatbot)
        const chatbot = new WhatsAppChatbot()
        chatbot.title = title
        chatbot.deviceId = deviceId
        chatbot.chatflowId = chatflowId
        chatbot.isActive = true
        if (typeof isFollowUpEnabled === 'boolean') chatbot.isFollowUpEnabled = isFollowUpEnabled
        if (typeof followUpDelayMinutes === 'number') chatbot.followUpDelayMinutes = followUpDelayMinutes
        if (typeof followUpSystemPrompt === 'string') chatbot.followUpSystemPrompt = followUpSystemPrompt
        if (typeof businessHoursEnabled === 'boolean') chatbot.businessHoursEnabled = businessHoursEnabled
        if (typeof businessHoursStart === 'string') chatbot.businessHoursStart = businessHoursStart
        if (typeof businessHoursEnd === 'string') chatbot.businessHoursEnd = businessHoursEnd
        if (typeof outsideHoursMessage === 'string') chatbot.outsideHoursMessage = outsideHoursMessage

        const savedChatbot = await repo.save(chatbot)
        return res.status(201).json(savedChatbot)
    } catch (error) {
        next(error)
    }
}

const updateChatbot = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params
        const {
            isActive,
            title,
            deviceId,
            chatflowId,
            isFollowUpEnabled,
            followUpDelayMinutes,
            followUpSystemPrompt,
            businessHoursEnabled,
            businessHoursStart,
            businessHoursEnd,
            outsideHoursMessage
        } = req.body

        const repo = getDataSource().getRepository(WhatsAppChatbot)
        const chatbot = await repo.findOneBy({ id })

        if (!chatbot) {
            return res.status(404).json({ error: 'Chatbot not found' })
        }

        if (typeof isActive === 'boolean') {
            chatbot.isActive = isActive
        }
        if (title) chatbot.title = title
        if (deviceId) chatbot.deviceId = deviceId
        if (chatflowId) chatbot.chatflowId = chatflowId
        if (typeof isFollowUpEnabled === 'boolean') chatbot.isFollowUpEnabled = isFollowUpEnabled
        if (typeof followUpDelayMinutes === 'number') chatbot.followUpDelayMinutes = followUpDelayMinutes
        if (typeof followUpSystemPrompt === 'string') chatbot.followUpSystemPrompt = followUpSystemPrompt
        if (typeof businessHoursEnabled === 'boolean') chatbot.businessHoursEnabled = businessHoursEnabled
        if (typeof businessHoursStart === 'string') chatbot.businessHoursStart = businessHoursStart
        if (typeof businessHoursEnd === 'string') chatbot.businessHoursEnd = businessHoursEnd
        if (typeof outsideHoursMessage === 'string') chatbot.outsideHoursMessage = outsideHoursMessage

        const updatedChatbot = await repo.save(chatbot)
        return res.status(200).json(updatedChatbot)
    } catch (error) {
        next(error)
    }
}

const deleteChatbot = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params
        const repo = getDataSource().getRepository(WhatsAppChatbot)
        const chatbot = await repo.findOneBy({ id })

        if (!chatbot) {
            return res.status(404).json({ error: 'Chatbot not found' })
        }

        await repo.delete({ id })
        return res.status(200).json({ message: 'Chatbot deleted successfully' })
    } catch (error) {
        next(error)
    }
}

const getChats = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { deviceId } = req.params
        const store = WhatsAppSessionManager.getInstance().getStore(deviceId)
        const client = WhatsAppSessionManager.getInstance().getClient(deviceId)
        if (!store || !client) {
            return res.status(404).json({ error: 'WhatsApp client or store not found' })
        }

        const deviceNumber = client.authState.creds.me?.id ? client.authState.creds.me.id.split(':')[0].split('@')[0] : ''

        // Filter out the device's own chat; store already excludes groups/status/newsletters.
        // listChats() sets `name` to the phone number and `id` to the preferred JID.
        const formattedChats = store.listChats().filter((chat) => {
            return chat.name !== deviceNumber && chat.id.split('@')[0] !== deviceNumber
        })
        return res.status(200).json(formattedChats)
    } catch (error) {
        next(error)
    }
}

const getMessages = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { deviceId, chatId } = req.params
        const store = WhatsAppSessionManager.getInstance().getStore(deviceId)
        if (!store) {
            return res.status(404).json({ error: 'WhatsApp store not found' })
        }

        return res.status(200).json(store.listMessages(chatId))
    } catch (error) {
        next(error)
    }
}

const sendMessage = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { deviceId, chatId } = req.params
        const { text } = req.body
        const client = WhatsAppSessionManager.getInstance().getClient(deviceId)
        if (!client) {
            return res.status(404).json({ error: 'WhatsApp client not connected or not found' })
        }

        // Baileys 7.x handles LID addressing + tctoken natively, so reply on the stored JID directly.
        const sent = await client.sendMessage(chatId, { text })
        if (!sent) {
            throw new Error('Failed to send message')
        }

        logger.info(`[WhatsApp] Message sent to: ${chatId} (id: ${sent.key.id}, status: ${sent.status})`)

        // Auto-pause AI for this chat when a human agent replies
        const store = WhatsAppSessionManager.getInstance().getStore(deviceId)
        if (store) {
            store.pauseChat(chatId, true)
        }

        return res.status(200).json({
            id: sent.key.id,
            body: text,
            fromMe: true,
            timestamp: sent.messageTimestamp
        })
    } catch (error) {
        next(error)
    }
}

const toggleChatAI = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { deviceId, chatId } = req.params
        const { isPaused } = req.body

        const store = WhatsAppSessionManager.getInstance().getStore(deviceId)
        if (!store) {
            return res.status(404).json({ error: 'WhatsApp store not found' })
        }

        store.pauseChat(chatId, !!isPaused)

        return res.status(200).json({ message: 'AI toggle updated successfully', isPaused: !!isPaused })
    } catch (error) {
        next(error)
    }
}

const deleteChat = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { deviceId, chatId } = req.params
        const client = WhatsAppSessionManager.getInstance().getClient(deviceId)
        const store = WhatsAppSessionManager.getInstance().getStore(deviceId)
        if (!client) {
            return res.status(404).json({ error: 'WhatsApp client not connected or not found' })
        }
        try {
            await client.chatModify({ delete: true, lastMessages: [] }, chatId)
        } catch (e: any) {
            logger.warn(`[WhatsApp] chatModify delete failed for ${chatId}: ${e.message}`)
        }
        store?.deleteChat(chatId)
        return res.status(200).json({ message: 'Chat deleted successfully' })
    } catch (error) {
        next(error)
    }
}

export default {
    getDevices,
    addDevice,
    deleteDevice,
    getDeviceQR,
    getChatbots,
    addChatbot,
    updateChatbot,
    deleteChatbot,
    getChats,
    getMessages,
    sendMessage,
    toggleChatAI,
    deleteChat
}
