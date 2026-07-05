import { Request, Response, NextFunction } from 'express'
import { v4 as uuidv4 } from 'uuid'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { getDataSource } from '../../DataSource'
import { WhatsAppDevice } from '../../database/entities/WhatsAppDevice'
import { WhatsAppChatbot } from '../../database/entities/WhatsAppChatbot'
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
        const { title, deviceId, chatflowId } = req.body
        if (!title || !deviceId || !chatflowId) {
            return res.status(400).json({ error: 'Title, deviceId, and chatflowId are required' })
        }

        const repo = getDataSource().getRepository(WhatsAppChatbot)
        const chatbot = new WhatsAppChatbot()
        chatbot.title = title
        chatbot.deviceId = deviceId
        chatbot.chatflowId = chatflowId
        chatbot.isActive = true

        const savedChatbot = await repo.save(chatbot)
        return res.status(201).json(savedChatbot)
    } catch (error) {
        next(error)
    }
}

const updateChatbot = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params
        const { isActive } = req.body

        const repo = getDataSource().getRepository(WhatsAppChatbot)
        const chatbot = await repo.findOneBy({ id })

        if (!chatbot) {
            return res.status(404).json({ error: 'Chatbot not found' })
        }

        if (typeof isActive === 'boolean') {
            chatbot.isActive = isActive
        }

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
        const client = WhatsAppSessionManager.getInstance().getClient(deviceId)
        if (!client) {
            return res.status(404).json({ error: 'WhatsApp client not connected or not found' })
        }
        const chats = await client.getChats()
        // Format the chats to send only necessary details
        const formattedChats = chats
            .filter((chat) => chat.id._serialized !== 'status@broadcast')
            .map((chat) => ({
                id: chat.id._serialized,
                name: chat.name || chat.id.user,
                isGroup: chat.isGroup,
                unreadCount: chat.unreadCount,
                timestamp: chat.timestamp
            }))
        return res.status(200).json(formattedChats)
    } catch (error) {
        next(error)
    }
}

const getMessages = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { deviceId, chatId } = req.params
        const client = WhatsAppSessionManager.getInstance().getClient(deviceId)
        if (!client) {
            return res.status(404).json({ error: 'WhatsApp client not connected or not found' })
        }
        const chat = await client.getChatById(chatId)
        if (!chat) {
            return res.status(404).json({ error: 'Chat not found' })
        }
        const messages = await chat.fetchMessages({ limit: 50 })
        const formattedMessages = messages.map((msg) => ({
            id: msg.id._serialized,
            body: msg.body,
            fromMe: msg.fromMe,
            timestamp: msg.timestamp,
            hasMedia: msg.hasMedia,
            type: msg.type
        }))
        return res.status(200).json(formattedMessages)
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
        const response = await client.sendMessage(chatId, text)
        return res.status(200).json({
            id: response.id._serialized,
            body: response.body,
            fromMe: response.fromMe,
            timestamp: response.timestamp
        })
    } catch (error) {
        next(error)
    }
}

const deleteChat = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { deviceId, chatId } = req.params
        const client = WhatsAppSessionManager.getInstance().getClient(deviceId)
        if (!client) {
            return res.status(404).json({ error: 'WhatsApp client not connected or not found' })
        }
        const chat = await client.getChatById(chatId)
        if (!chat) {
            return res.status(404).json({ error: 'Chat not found' })
        }
        await chat.delete()
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
    deleteChat
}
