import { Request, Response, NextFunction } from 'express'
import { v4 as uuidv4 } from 'uuid'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { exec } from 'child_process'
import { promisify } from 'util'
import { downloadMediaMessage } from '@whiskeysockets/baileys'

const execPromise = promisify(exec)
import { getDataSource } from '../../DataSource'
import { WhatsAppDevice } from '../../database/entities/WhatsAppDevice'
import { WhatsAppChatbot } from '../../database/entities/WhatsAppChatbot'
import { ChatMessage } from '../../database/entities/ChatMessage'
import { WhatsAppCampaign } from '../../database/entities/WhatsAppCampaign'
import { WhatsAppCampaignRecipient } from '../../database/entities/WhatsAppCampaignRecipient'
import logger from '../../utils/logger'
import { WhatsAppSessionManager } from '../../utils/WhatsAppSessionManager'
import { validateAPIKey } from '../../utils/validateKey'

const checkAllowedDevice = async (req: Request, deviceId: string): Promise<boolean> => {
    const currentUser = req.user as any
    if (currentUser && currentUser.email === 'admin@admin.com') return true
    try {
        const repo = getDataSource().getRepository(WhatsAppDevice)
        const device = await repo.findOneBy({ id: deviceId })
        if (device && device.createdBy === currentUser?.id) {
            return true
        }
    } catch (e) {
        logger.error('Error checking device owner in checkAllowedDevice:', e)
    }
    if (currentUser) {
        try {
            const allowedIds = currentUser.allowedDevices ? JSON.parse(currentUser.allowedDevices) : []
            if (Array.isArray(allowedIds)) {
                return allowedIds.includes(deviceId)
            }
        } catch (e) {
            logger.error('Error parsing allowedDevices for user:', e)
        }
    }
    return false
}

const getDevices = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const repo = getDataSource().getRepository(WhatsAppDevice)
        let devices = await repo.find({ order: { createdDate: 'DESC' } })

        const currentUser = req.user as any
        logger.info(
            `[WhatsApp] getDevices called by ${currentUser?.email || 'unknown'}. AllowedDevices: ${
                currentUser?.allowedDevices
            }. Total devices found in DB: ${devices.length}`
        )

        if (currentUser && currentUser.email !== 'admin@admin.com') {
            try {
                const allowedIds = currentUser.allowedDevices ? JSON.parse(currentUser.allowedDevices) : []
                const allowedSet = new Set(Array.isArray(allowedIds) ? allowedIds : [])
                devices = devices.filter((device) => {
                    return allowedSet.has(device.id) || device.createdBy === currentUser.id
                })
            } catch (e) {
                logger.error('Error filtering allowed devices:', e)
            }
        }
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

        const currentUser = req.user as any
        if (currentUser) {
            device.createdBy = currentUser.id
        }

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
        if (!(await checkAllowedDevice(req, id))) {
            return res.status(403).json({ error: 'Access denied' })
        }
        const repo = getDataSource().getRepository(WhatsAppDevice)
        const device = await repo.findOneBy({ id })

        if (!device) {
            return res.status(404).json({ error: 'Device not found' })
        }

        // Close and destroy the active WhatsApp Client
        await WhatsAppSessionManager.getInstance().closeSession(id)

        // Delete the session data folder on disk
        const sessionsDir = path.join(os.homedir(), '.flowise', 'whatsapp_sessions')
        const authPath = path.join(sessionsDir, `auth-${device.sessionName}`)
        const storePath = path.join(sessionsDir, `store-${device.sessionName}.json`)

        if (fs.existsSync(authPath)) {
            try {
                fs.rmSync(authPath, { recursive: true, force: true })
            } catch (err) {
                console.error(`Failed to delete auth directory:`, err)
            }
        }
        if (fs.existsSync(storePath)) {
            try {
                fs.rmSync(storePath, { force: true })
            } catch (err) {
                console.error(`Failed to delete store file:`, err)
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
        if (!(await checkAllowedDevice(req, id))) {
            return res.status(403).json({ error: 'Access denied' })
        }
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

        const currentUser = req.user as any
        if (currentUser && currentUser.email !== 'admin@admin.com') {
            const filteredChatbots = []
            for (const bot of chatbots) {
                if (await checkAllowedDevice(req, bot.deviceId)) {
                    filteredChatbots.push(bot)
                }
            }
            return res.status(200).json(filteredChatbots)
        }

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

        if (!(await checkAllowedDevice(req, deviceId))) {
            return res.status(403).json({ error: 'Access denied' })
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

        if (!(await checkAllowedDevice(req, chatbot.deviceId))) {
            return res.status(403).json({ error: 'Access denied' })
        }

        if (deviceId && deviceId !== chatbot.deviceId) {
            if (!(await checkAllowedDevice(req, deviceId))) {
                return res.status(403).json({ error: 'Access denied' })
            }
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

        if (!(await checkAllowedDevice(req, chatbot.deviceId))) {
            return res.status(403).json({ error: 'Access denied' })
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
        if (!(await checkAllowedDevice(req, deviceId))) {
            return res.status(403).json({ error: 'Access denied' })
        }
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
        if (!(await checkAllowedDevice(req, deviceId))) {
            return res.status(403).json({ error: 'Access denied' })
        }
        const store = WhatsAppSessionManager.getInstance().getStore(deviceId)
        if (!store) {
            return res.status(404).json({ error: 'WhatsApp store not found' })
        }

        store.markChatAsRead(chatId)

        return res.status(200).json(store.listMessages(chatId))
    } catch (error) {
        next(error)
    }
}

const sendMessage = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { deviceId, chatId } = req.params
        if (!(await checkAllowedDevice(req, deviceId))) {
            return res.status(403).json({ error: 'Access denied' })
        }
        const { text, file } = req.body
        const client = WhatsAppSessionManager.getInstance().getClient(deviceId)
        if (!client) {
            return res.status(404).json({ error: 'WhatsApp client not connected or not found' })
        }

        let sent: any
        let responseBody = text || ''

        if (file && file.data) {
            let base64Data = file.data
            if (base64Data.includes(';base64,')) {
                base64Data = base64Data.split(';base64,')[1]
            }
            const buffer = Buffer.from(base64Data, 'base64')
            const mimeType = file.mimeType || 'application/octet-stream'
            const fileName = file.name || 'file'

            if (mimeType.startsWith('image/')) {
                sent = await client.sendMessage(chatId, { image: buffer, caption: text || '' })
                responseBody = text ? `📷 ${text}` : '📷 Photo'
            } else if (mimeType.startsWith('video/')) {
                sent = await client.sendMessage(chatId, { video: buffer, caption: text || '' })
                responseBody = text ? `🎥 ${text}` : '🎥 Video'
            } else if (mimeType.startsWith('audio/')) {
                let sendBuffer: any = buffer
                let sendMime = mimeType

                try {
                    const tempDir = path.join(process.cwd(), 'uploads', 'temp')
                    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })
                    const tempInput = path.join(tempDir, `input_${uuidv4()}.webm`)
                    const tempOutput = path.join(tempDir, `output_${uuidv4()}.ogg`)

                    await fs.promises.writeFile(tempInput, buffer)
                    await execPromise(
                        `ffmpeg -y -i "${tempInput}" -c:a libopus -b:a 48k -ac 1 -avoid_negative_ts make_zero -f opus "${tempOutput}"`
                    )

                    if (fs.existsSync(tempOutput)) {
                        sendBuffer = await fs.promises.readFile(tempOutput)
                        sendMime = 'audio/ogg; codecs=opus'
                    }

                    try {
                        if (fs.existsSync(tempInput)) await fs.promises.unlink(tempInput)
                        if (fs.existsSync(tempOutput)) await fs.promises.unlink(tempOutput)
                    } catch (e) {
                        // ignore cleanup errors
                    }
                } catch (err: any) {
                    logger.error(`[WhatsApp] Failed to transcode audio to Ogg Opus: ${err.message}`)
                }

                sent = await client.sendMessage(chatId, { audio: sendBuffer, mimetype: sendMime, ptt: true })
                responseBody = '🎵 Audio message'
            } else {
                sent = await client.sendMessage(chatId, { document: buffer, mimetype: mimeType, fileName: fileName, caption: text || '' })
                responseBody = `📄 Document: ${fileName}` + (text ? ` (${text})` : '')
            }
        } else {
            sent = await client.sendMessage(chatId, { text })
        }

        if (!sent) {
            throw new Error('Failed to send message')
        }

        logger.info(`[WhatsApp] Message sent to: ${chatId} (id: ${sent.key.id}, status: ${sent.status})`)

        const store = WhatsAppSessionManager.getInstance().getStore(deviceId)
        if (store && sent.key?.id) {
            const jid = chatId
            if (!store.messages.has(jid)) {
                store.messages.set(jid, new Map())
            }
            store.messages.get(jid)!.set(sent.key.id, sent)
        }

        // Auto-pause AI for this chat when a human agent replies
        if (store) {
            store.pauseChat(chatId, true)
        }

        return res.status(200).json({
            id: sent.key.id,
            body: responseBody,
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
        if (!(await checkAllowedDevice(req, deviceId))) {
            return res.status(403).json({ error: 'Access denied' })
        }
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
        if (!(await checkAllowedDevice(req, deviceId))) {
            return res.status(403).json({ error: 'Access denied' })
        }
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

        // Clear chatbot memory/history for this contact JID and its alias (PN/LID)
        try {
            const idsToDelete = [chatId]
            const pn = chatId.endsWith('@s.whatsapp.net') ? chatId : store?.lidToPn.get(chatId)
            const lid = chatId.endsWith('@lid') ? chatId : store?.pnToLid.get(chatId)
            if (pn && !idsToDelete.includes(pn)) idsToDelete.push(pn)
            if (lid && !idsToDelete.includes(lid)) idsToDelete.push(lid)

            const chatMessageRepo = getDataSource().getRepository(ChatMessage)
            for (const id of idsToDelete) {
                const senderId = id.split('@')[0]
                const dbChatId = `whatsapp_${senderId}`
                await chatMessageRepo.delete({ chatId: dbChatId })
            }
            logger.info(`[WhatsApp] Pruned ChatMessage history in database for contact JIDs: ${idsToDelete.join(', ')}`)
        } catch (dbErr: any) {
            logger.error(`[WhatsApp] Failed to prune ChatMessage database records: ${dbErr.message}`)
        }

        return res.status(200).json({ message: 'Chat deleted successfully' })
    } catch (error) {
        next(error)
    }
}

const downloadMessageMedia = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { deviceId, chatId, messageId } = req.params
        if (!(await checkAllowedDevice(req, deviceId))) {
            return res.status(403).json({ error: 'Access denied' })
        }

        const client = WhatsAppSessionManager.getInstance().getClient(deviceId)
        const store = WhatsAppSessionManager.getInstance().getStore(deviceId)
        if (!client || !store) {
            return res.status(404).json({ error: 'WhatsApp client or store not found' })
        }

        const msg = store.getRawMessage(chatId, messageId)
        if (!msg) {
            return res.status(404).json({ error: 'Message not found in store history' })
        }

        const messageType = Object.keys(msg.message || {})[0]
        if (!['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'].includes(messageType)) {
            return res.status(400).json({ error: 'Message is not a media message' })
        }

        const mediaMessage = (msg.message as any)[messageType]
        const mimeType = mediaMessage.mimetype || 'application/octet-stream'

        const buffer = await downloadMediaMessage(
            msg,
            'buffer',
            {},
            {
                logger: logger as any,
                reuploadRequest: client.updateMediaMessage
            }
        )

        res.setHeader('Content-Type', mimeType)
        return res.send(buffer)
    } catch (error: any) {
        logger.error('[WhatsApp] Failed to download media:', error)
        next(error)
    }
}

const getCampaigns = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const repo = getDataSource().getRepository(WhatsAppCampaign)
        const currentUser = req.user as any
        let campaigns: WhatsAppCampaign[] = []
        if (currentUser && currentUser.email === 'admin@admin.com') {
            campaigns = await repo.find({ order: { createdDate: 'DESC' } })
        } else if (currentUser) {
            campaigns = await repo.find({
                where: { createdBy: currentUser.id },
                order: { createdDate: 'DESC' }
            })
        }
        return res.status(200).json(campaigns)
    } catch (error) {
        next(error)
    }
}

const createCampaign = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const {
            name,
            messageTemplate,
            deviceIds,
            recipients,
            baseDelay,
            jitter,
            dailyLimit,
            scheduledDate,
            sendingAllowedHoursStart,
            sendingAllowedHoursEnd
        } = req.body
        if (
            !name ||
            !messageTemplate ||
            !Array.isArray(deviceIds) ||
            deviceIds.length === 0 ||
            !Array.isArray(recipients) ||
            recipients.length === 0
        ) {
            return res.status(400).json({ error: 'Name, messageTemplate, deviceIds, and recipients are required' })
        }

        // Check permissions for each device
        for (const devId of deviceIds) {
            if (!(await checkAllowedDevice(req, devId))) {
                return res.status(403).json({ error: `Access denied to device: ${devId}` })
            }
        }

        const currentUser = req.user as any
        const dataSource = getDataSource()
        const campaignRepo = dataSource.getRepository(WhatsAppCampaign)
        const recipientRepo = dataSource.getRepository(WhatsAppCampaignRecipient)

        const campaign = new WhatsAppCampaign()
        campaign.name = name
        campaign.messageTemplate = messageTemplate
        campaign.deviceIds = JSON.stringify(deviceIds)
        campaign.status = scheduledDate ? 'SCHEDULED' : 'PENDING'
        campaign.totalRecipients = recipients.length
        campaign.sentCount = 0
        campaign.failedCount = 0
        campaign.baseDelay = baseDelay !== undefined ? Number(baseDelay) : 30
        campaign.jitter = jitter !== undefined ? Number(jitter) : 10
        campaign.dailyLimit = dailyLimit !== undefined ? Number(dailyLimit) : 150
        campaign.scheduledDate = scheduledDate ? new Date(scheduledDate) : undefined
        campaign.sendingAllowedHoursStart = sendingAllowedHoursStart || undefined
        campaign.sendingAllowedHoursEnd = sendingAllowedHoursEnd || undefined
        if (currentUser) {
            campaign.createdBy = currentUser.id
        }

        const savedCampaign = await campaignRepo.save(campaign)

        // Insert recipients
        const recipientEntities = recipients.map((r: any) => {
            const rec = new WhatsAppCampaignRecipient()
            rec.campaignId = savedCampaign.id
            rec.phoneNumber = r.phoneNumber
            rec.name = r.name
            rec.status = 'PENDING'
            return rec
        })

        // Save recipient entities in chunks to avoid sqlite variable limit limits (max 999 variables)
        const chunkSize = 100
        for (let i = 0; i < recipientEntities.length; i += chunkSize) {
            const chunk = recipientEntities.slice(i, i + chunkSize)
            await recipientRepo.save(chunk)
        }

        return res.status(201).json(savedCampaign)
    } catch (error) {
        next(error)
    }
}

const getCampaign = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params
        const campaignRepo = getDataSource().getRepository(WhatsAppCampaign)
        const recipientRepo = getDataSource().getRepository(WhatsAppCampaignRecipient)

        const campaign = await campaignRepo.findOneBy({ id })
        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' })
        }

        // Access control
        const currentUser = req.user as any
        if (currentUser && currentUser.email !== 'admin@admin.com' && campaign.createdBy !== currentUser.id) {
            return res.status(403).json({ error: 'Access denied' })
        }

        const recipients = await recipientRepo.find({
            where: { campaignId: id },
            order: { createdDate: 'ASC' }
        })

        return res.status(200).json({
            ...campaign,
            recipients
        })
    } catch (error) {
        next(error)
    }
}

const startCampaign = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params
        const repo = getDataSource().getRepository(WhatsAppCampaign)
        const campaign = await repo.findOneBy({ id })
        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' })
        }

        const currentUser = req.user as any
        if (currentUser && currentUser.email !== 'admin@admin.com' && campaign.createdBy !== currentUser.id) {
            return res.status(403).json({ error: 'Access denied' })
        }

        campaign.status = 'RUNNING'
        const updated = await repo.save(campaign)
        return res.status(200).json(updated)
    } catch (error) {
        next(error)
    }
}

const pauseCampaign = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params
        const repo = getDataSource().getRepository(WhatsAppCampaign)
        const campaign = await repo.findOneBy({ id })
        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' })
        }

        const currentUser = req.user as any
        if (currentUser && currentUser.email !== 'admin@admin.com' && campaign.createdBy !== currentUser.id) {
            return res.status(403).json({ error: 'Access denied' })
        }

        campaign.status = 'PAUSED'
        const updated = await repo.save(campaign)
        return res.status(200).json(updated)
    } catch (error) {
        next(error)
    }
}

const deleteCampaign = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params
        const campaignRepo = getDataSource().getRepository(WhatsAppCampaign)
        const recipientRepo = getDataSource().getRepository(WhatsAppCampaignRecipient)

        const campaign = await campaignRepo.findOneBy({ id })
        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' })
        }

        const currentUser = req.user as any
        if (currentUser && currentUser.email !== 'admin@admin.com' && campaign.createdBy !== currentUser.id) {
            return res.status(403).json({ error: 'Access denied' })
        }

        await recipientRepo.delete({ campaignId: id })
        await campaignRepo.delete({ id })

        return res.status(200).json({ message: 'Campaign deleted successfully' })
    } catch (error) {
        next(error)
    }
}

const getDeviceGroups = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { deviceId } = req.params
        if (!(await checkAllowedDevice(req, deviceId))) {
            return res.status(403).json({ error: 'Access denied' })
        }

        const client = WhatsAppSessionManager.getInstance().getClient(deviceId)
        if (!client) {
            return res.status(404).json({ error: 'WhatsApp device not connected or not found' })
        }

        // Fetch all participating groups
        const groups = await client.groupFetchAllParticipating()
        const formattedGroups = Object.values(groups).map((group: any) => ({
            id: group.id,
            subject: group.subject,
            participantsCount: group.participants ? group.participants.length : 0
        }))

        return res.status(200).json(formattedGroups)
    } catch (error) {
        next(error)
    }
}

const getGroupParticipants = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { deviceId, groupId } = req.params
        if (!(await checkAllowedDevice(req, deviceId))) {
            return res.status(403).json({ error: 'Access denied' })
        }

        const client = WhatsAppSessionManager.getInstance().getClient(deviceId)
        if (!client) {
            return res.status(404).json({ error: 'WhatsApp device not connected or not found' })
        }

        const groupMeta = await client.groupMetadata(groupId)
        if (!groupMeta) {
            return res.status(404).json({ error: 'Group metadata not found' })
        }

        const store = WhatsAppSessionManager.getInstance().getStore(deviceId)

        const participants = await Promise.all(
            groupMeta.participants.map(async (p: any) => {
                let realJid = p.id
                if (p.id.endsWith('@lid')) {
                    const mappedPn = store?.lidToPn?.get(p.id)
                    if (mappedPn) {
                        realJid = mappedPn
                    } else {
                        try {
                            const resolvedPn = await (client as any).signalRepository?.lidMapping?.getPNForLID?.(p.id)
                            if (resolvedPn && typeof resolvedPn === 'string' && resolvedPn.endsWith('@s.whatsapp.net')) {
                                realJid = resolvedPn
                                store?.recordLidMapping?.(p.id, resolvedPn)
                                store?.save?.()
                            }
                        } catch (err) {
                            // ignore resolve errors
                        }
                    }
                }
                const phoneNumber = realJid.split('@')[0]
                return {
                    jid: realJid,
                    phoneNumber,
                    role: p.admin ? (p.admin === 'superadmin' ? 'Super Admin' : 'Admin') : 'Member'
                }
            })
        )

        return res.status(200).json({
            id: groupMeta.id,
            subject: groupMeta.subject,
            participants
        })
    } catch (error) {
        next(error)
    }
}

const filterWhatsAppNumbers = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { deviceId } = req.params
        const { phoneNumbers } = req.body

        if (!(await checkAllowedDevice(req, deviceId))) {
            return res.status(403).json({ error: 'Access denied' })
        }

        const client = WhatsAppSessionManager.getInstance().getClient(deviceId)
        if (!client) {
            return res.status(404).json({ error: 'WhatsApp device not connected or not found' })
        }

        if (!phoneNumbers || !Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
            return res.status(400).json({ error: 'No phone numbers provided' })
        }

        const valid: string[] = []
        const invalid: string[] = []

        const checkNumber = async (rawPhone: string) => {
            let clean = rawPhone.replace(/\D/g, '')
            if (clean.startsWith('00')) {
                clean = clean.substring(2)
            }
            if (!clean) {
                invalid.push(rawPhone)
                return
            }

            try {
                const result = await client.onWhatsApp(clean)
                if (result && result.length > 0 && result[0].exists) {
                    valid.push(rawPhone)
                } else {
                    invalid.push(rawPhone)
                }
            } catch (err) {
                invalid.push(rawPhone)
            }
        }

        const chunkSize = 5
        for (let i = 0; i < phoneNumbers.length; i += chunkSize) {
            const chunk = phoneNumbers.slice(i, i + chunkSize)
            await Promise.all(chunk.map((num) => checkNumber(num)))
        }

        return res.status(200).json({ valid, invalid })
    } catch (error) {
        next(error)
    }
}

const restSendMessage = async (req: Request, res: Response, _next: NextFunction) => {
    try {
        let token = (req.headers.authorization || '').split('Bearer ').pop()
        if (!token) {
            token = (req.body.token as string) ?? (req.query.token as string) ?? ''
            if (token) {
                req.headers.authorization = `Bearer ${token}`
            }
        }

        const authRes = await validateAPIKey(req)
        if (!authRes.isValid) {
            return res.status(401).json({ success: false, message: 'Authentication failed. Invalid API token.' })
        }

        const cleanFrom = String(req.body.from ?? req.query.from ?? '').replace(/\D/g, '')
        let rawTo = String(req.body.to ?? req.query.to ?? '').trim()
        const messageType = String(req.body.messageType ?? req.query.messageType ?? 'text')

        if (!cleanFrom) {
            return res.status(400).json({ success: false, message: 'Sender number (from) is required' })
        }
        if (!rawTo) {
            return res.status(400).json({ success: false, message: 'Recipient number (to) is required' })
        }

        const deviceRepo = getDataSource().getRepository(WhatsAppDevice)
        const device = await deviceRepo.findOneBy({ phoneNumber: cleanFrom })
        if (!device) {
            return res.status(404).json({ success: false, message: `Sender device with number ${cleanFrom} not found` })
        }

        const client = WhatsAppSessionManager.getInstance().getClient(device.id)
        if (!client) {
            return res.status(400).json({ success: false, message: 'WhatsApp device is not connected' })
        }

        let jid = rawTo
        if (!jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@g.us')) {
            const cleanTo = jid.replace(/\D/g, '')
            jid = `${cleanTo}@s.whatsapp.net`
        }

        let baileysMessage: any = null

        if (messageType === 'text') {
            const text = req.body.text ?? req.query.text
            if (!text) return res.status(400).json({ success: false, message: 'text parameter is required' })
            baileysMessage = { text }
        } else if (messageType === 'image') {
            const imageUrl = req.body.imageUrl ?? req.query.imageUrl
            const caption = req.body.caption ?? req.query.caption
            if (!imageUrl) return res.status(400).json({ success: false, message: 'imageUrl parameter is required' })
            baileysMessage = { image: { url: imageUrl }, caption }
        } else if (messageType === 'video') {
            const videoUrl = req.body.videoUrl ?? req.query.videoUrl
            const caption = req.body.caption ?? req.query.caption
            if (!videoUrl) return res.status(400).json({ success: false, message: 'videoUrl parameter is required' })
            baileysMessage = { video: { url: videoUrl }, caption }
        } else if (messageType === 'audio') {
            const aacUrl = req.body.aacUrl ?? req.query.aacUrl
            if (!aacUrl) return res.status(400).json({ success: false, message: 'aacUrl parameter is required' })
            baileysMessage = { audio: { url: aacUrl }, mimetype: 'audio/mp4' }
        } else if (messageType === 'document') {
            const docUrl = req.body.docUrl ?? req.query.docUrl
            const caption = req.body.caption ?? req.query.caption
            if (!docUrl) return res.status(400).json({ success: false, message: 'docUrl parameter is required' })
            const filename = docUrl.split('/').pop() || 'document.pdf'
            baileysMessage = { document: { url: docUrl }, fileName: filename, caption }
        } else if (messageType === 'location') {
            const lat = Number(req.body.lat ?? req.query.lat)
            const long = Number(req.body.long ?? req.query.long)
            const title = req.body.title ?? req.query.title
            if (isNaN(lat) || isNaN(long)) {
                return res.status(400).json({ success: false, message: 'lat and long parameters are required and must be numbers' })
            }
            baileysMessage = { location: { degreesLatitude: lat, degreesLongitude: long, name: title } }
        } else {
            return res.status(400).json({ success: false, message: `Unsupported messageType: ${messageType}` })
        }

        const response = await client.sendMessage(jid, baileysMessage)
        const messageId = response?.key?.id || 'unknown'
        const timestamp = new Date().toISOString()

        return res.status(200).json({
            success: true,
            message: 'Sent',
            data: {
                messageId,
                timestamp,
                recipient: rawTo,
                messageType,
                contentPreview: messageType === 'text' ? (baileysMessage.text as string).substring(0, 50) : `${messageType} message`
            }
        })
    } catch (error: any) {
        logger.error('[WhatsApp REST API] Failed to send message:', error)
        return res.status(500).json({ success: false, message: 'Message not sent', solution: error.message })
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
    deleteChat,
    downloadMessageMedia,
    getCampaigns,
    createCampaign,
    getCampaign,
    startCampaign,
    pauseCampaign,
    deleteCampaign,
    getDeviceGroups,
    getGroupParticipants,
    filterWhatsAppNumbers,
    restSendMessage
}
