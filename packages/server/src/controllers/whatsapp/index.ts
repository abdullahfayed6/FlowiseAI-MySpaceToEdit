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
import { generateWAMessage } from '@whiskeysockets/baileys'
import pino from 'pino'

const pinoLogger = pino({ level: 'silent' })

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
        const store = WhatsAppSessionManager.getInstance().getStore(deviceId)
        const client = WhatsAppSessionManager.getInstance().getClient(deviceId)
        if (!store || !client) {
            return res.status(404).json({ error: 'WhatsApp client or store not found' })
        }

        const deviceNumber = client.authState.creds.me?.id ? client.authState.creds.me.id.split(':')[0].split('@')[0] : ''

        const chats = store.chats.all()
        const formattedChats = chats
            .filter((chat: any) => {
                const jid = chat.id
                if (jid === 'status@broadcast') return false
                if (jid.endsWith('@g.us')) return false

                // Filter out self-chats/system chats
                const chatNumber = jid.split('@')[0]
                if (chatNumber === deviceNumber) return false

                return true
            })
            .map((chat: any) => ({
                id: chat.id,
                name: chat.name || chat.id.split('@')[0],
                unreadCount: chat.unreadCount || 0,
                timestamp: chat.conversationTimestamp || 0
            }))
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

        // Map chatId (Phone JID) to targetChatId (LID JID) from the store if it exists
        let targetChatId = chatId
        if (chatId.endsWith('@s.whatsapp.net')) {
            const chats = store.chats.all()
            const foundChat = chats.find((c: any) => c.pnJid === chatId)
            if (foundChat && foundChat.id) {
                targetChatId = foundChat.id
            }
        }

        logger.info(`[WhatsApp] getMessages: requesting for chatId: "${chatId}", mapped to targetChatId: "${targetChatId}"`)
        logger.info(`[WhatsApp] getMessages: available store.messages keys: ${JSON.stringify(Object.keys(store.messages))}`)

        const messages = store.messages[targetChatId] ? store.messages[targetChatId].all() : []
        logger.info(`[WhatsApp] getMessages: found ${messages.length} messages in store for "${targetChatId}"`)

        const formattedMessages = messages.map((msg: any) => {
            const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || ''
            return {
                id: msg.key.id,
                body,
                fromMe: msg.key.fromMe || false,
                timestamp: msg.messageTimestamp
            }
        })
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
        const store = WhatsAppSessionManager.getInstance().getStore(deviceId)
        if (!client) {
            return res.status(404).json({ error: 'WhatsApp client not connected or not found' })
        }

        let targetJid = chatId
        let phoneJid = chatId.endsWith('@s.whatsapp.net') ? chatId : null
        let lidJid = chatId.endsWith('@lid') ? chatId : null
        let tokenBuffer: Buffer | null = null

        if (store) {
            // Find chat by phone JID or LID JID
            const chats = store.chats.all()
            const chat = chats.find((c: any) => c.id === chatId || (c.pnJid && c.pnJid === chatId))

            if (chat) {
                if (chat.pnJid) {
                    phoneJid = chat.pnJid
                    targetJid = chat.pnJid
                }
                if (chat.id.endsWith('@lid')) {
                    lidJid = chat.id
                }

                // Extract tcToken
                if (chat.tcToken) {
                    try {
                        const rawToken = chat.tcToken as any
                        if (Buffer.isBuffer(rawToken)) {
                            tokenBuffer = rawToken
                        } else if (rawToken && rawToken.type === 'Buffer' && Array.isArray(rawToken.data)) {
                            tokenBuffer = Buffer.from(rawToken.data)
                        } else {
                            tokenBuffer = Buffer.from(rawToken)
                        }

                        if (lidJid) {
                            logger.info(`[WhatsApp] Subscribing to presence for LID JID ${lidJid} with tcToken...`)
                            await client.presenceSubscribe(lidJid, tokenBuffer)
                        }
                        if (phoneJid) {
                            logger.info(`[WhatsApp] Subscribing to presence for Phone JID ${phoneJid} with tcToken...`)
                            await client.presenceSubscribe(phoneJid, tokenBuffer)
                        }

                        logger.info(`[WhatsApp] Subscribed to presence. Waiting 2.5s for server propagation...`)
                        await new Promise((resolve) => setTimeout(resolve, 2500))
                    } catch (e: any) {
                        logger.warn(`[WhatsApp] Failed to subscribe presence: ${e.message}`)
                    }
                }
            }
        }

        const additionalNodes: any[] = []
        if (tokenBuffer) {
            additionalNodes.push({
                tag: 'tctoken',
                attrs: {},
                content: tokenBuffer
            })
            logger.info(`[WhatsApp] Attaching tctoken directly to the message stanza for ${targetJid}`)
        }

        const storeJid = lidJid || chatId
        const userJid = client.authState.creds.me?.id || (client.user ? client.user.id : '')
        const fullMsg = await generateWAMessage(storeJid, { text }, {
            logger: pinoLogger,
            userJid,
            upload: client.waUploadToServer
        } as any)

        await client.relayMessage(targetJid, fullMsg.message!, {
            messageId: fullMsg.key.id || undefined,
            additionalNodes
        })

        client.ev.emit('messages.upsert', {
            messages: [fullMsg],
            type: 'append'
        })

        logger.info(`[WhatsApp] Message sent successfully via relayMessage to: ${targetJid}`)

        if (!fullMsg) {
            throw new Error('Failed to send message')
        }

        const response = fullMsg
        return res.status(200).json({
            id: response.key.id,
            body: response.message?.conversation || text,
            fromMe: response.key.fromMe || false,
            timestamp: response.messageTimestamp
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
        await client.chatModify({ delete: true, lastMessages: [] }, chatId)
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
