import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    makeInMemoryStore,
    WASocket,
    fetchLatestBaileysVersion,
    generateWAMessage
} from '@whiskeysockets/baileys'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { Request } from 'express'
import { getDataSource } from '../DataSource'
import { WhatsAppDevice } from '../database/entities/WhatsAppDevice'
import { WhatsAppChatbot } from '../database/entities/WhatsAppChatbot'
import { utilBuildChatflow } from './buildChatflow'
import logger from './logger'
import * as qrcode from 'qrcode'
import pino from 'pino'

const pinoLogger: any = pino({ level: 'silent' })

export class WhatsAppSessionManager {
    private static instance: WhatsAppSessionManager
    private clients: Map<string, WASocket> = new Map()
    private stores: Map<string, any> = new Map()
    private sessionNames: Map<string, string> = new Map()
    private initializing: Set<string> = new Set()

    private constructor() {
        const cleanup = () => {
            logger.info('[WhatsApp] Process exiting. Saving all active session stores...')
            for (const [deviceId, store] of this.stores.entries()) {
                try {
                    const sessionName = this.sessionNames.get(deviceId)
                    if (sessionName) {
                        const storePath = path.join(os.homedir(), '.flowise', 'whatsapp_sessions', `store-${sessionName}.json`)
                        store.writeToFile(storePath)
                    }
                } catch (e) {
                    // ignore
                }
            }
        }
        process.on('SIGINT', () => {
            cleanup()
            process.exit(0)
        })
        process.on('SIGTERM', () => {
            cleanup()
            process.exit(0)
        })
    }

    public static getInstance(): WhatsAppSessionManager {
        if (!WhatsAppSessionManager.instance) {
            WhatsAppSessionManager.instance = new WhatsAppSessionManager()
        }
        return WhatsAppSessionManager.instance
    }

    public async initializeAllSessions(): Promise<void> {
        try {
            // Clean up any remaining zombie Puppeteer Chrome processes on Windows startup (from older runs)
            if (process.platform === 'win32') {
                try {
                    const { execSync } = require('child_process')
                    execSync(
                        'powershell -Command "Get-Process | Where-Object { $_.Path -like \'*\\\\puppeteer\\\\*\' } | Stop-Process -Force"',
                        { stdio: 'ignore' }
                    )
                    logger.info('[WhatsApp] Cleaned up zombie Puppeteer Chrome processes on startup.')
                } catch (e: any) {
                    logger.warn('[WhatsApp] Failed to clean up zombie processes on startup:', e.message)
                }
            }

            const dataSource = getDataSource()
            const deviceRepo = dataSource.getRepository(WhatsAppDevice)
            const devices = await deviceRepo.find()

            for (const device of devices) {
                if (device.status === 'CONNECTED') {
                    try {
                        logger.info(`[WhatsApp] Restoring session for device ${device.name} sequentially...`)
                        await this.initSession(device.id)
                        // Wait 3 seconds to let this instance settle before launching the next one
                        await new Promise((resolve) => setTimeout(resolve, 3000))
                    } catch (err: any) {
                        logger.error(`Failed to restore WhatsApp session ${device.name}:`, err.message)
                    }
                } else if (device.status === 'QR' || device.status === 'INITIALIZING') {
                    device.status = 'DISCONNECTED'
                    device.qrCode = undefined
                    await deviceRepo.save(device)
                }
            }
        } catch (error) {
            logger.error('Error initializing WhatsApp sessions:', error)
        }
    }

    public async initSession(deviceId: string): Promise<WASocket | undefined> {
        if (this.clients.has(deviceId)) {
            return this.clients.get(deviceId)!
        }
        if (this.initializing.has(deviceId)) {
            return undefined
        }
        this.initializing.add(deviceId)

        const dataSource = getDataSource()
        const deviceRepo = dataSource.getRepository(WhatsAppDevice)
        const chatbotRepo = dataSource.getRepository(WhatsAppChatbot)

        const device = await deviceRepo.findOneBy({ id: deviceId })
        if (!device) {
            this.initializing.delete(deviceId)
            throw new Error('WhatsApp device not found')
        }

        this.sessionNames.set(deviceId, device.sessionName)

        device.status = 'INITIALIZING'
        device.qrCode = undefined
        await deviceRepo.save(device)

        const sessionsDir = path.join(os.homedir(), '.flowise', 'whatsapp_sessions')
        if (!fs.existsSync(sessionsDir)) {
            fs.mkdirSync(sessionsDir, { recursive: true })
        }

        const authPath = path.join(sessionsDir, `auth-${device.sessionName}`)
        const storePath = path.join(sessionsDir, `store-${device.sessionName}.json`)

        // Initialize Auth state
        // eslint-disable-next-line react-hooks/rules-of-hooks
        const { state, saveCreds } = await useMultiFileAuthState(authPath)

        // Initialize Store
        const store = makeInMemoryStore({ logger: pinoLogger })
        if (fs.existsSync(storePath)) {
            try {
                store.readFromFile(storePath)
            } catch (err) {
                logger.error(`Failed to read store for device ${device.name}:`, err)
            }
        }
        this.stores.set(deviceId, store)

        // Fetch latest WhatsApp Web version to prevent connection failure rejects
        let version: any = [2, 3000, 1015901307]
        try {
            const fetched = await fetchLatestBaileysVersion()
            version = fetched.version
            logger.info(`[WhatsApp Device ${device.name}] Fetched latest WhatsApp Web version: ${version.join('.')}`)
        } catch (e: any) {
            logger.warn(`[WhatsApp Device ${device.name}] Failed to fetch latest WA version, using fallback:`, e.message)
        }

        // Create socket connection
        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            logger: pinoLogger,
            browser: ['Windows', 'Chrome', '120.0.0']
        })

        // Bind store events to the socket
        store.bind(sock.ev)

        this.clients.set(deviceId, sock)

        // Save store periodically
        const storeInterval = setInterval(() => {
            try {
                store.writeToFile(storePath)
            } catch (e) {
                // ignore
            }
        }, 10000)

        // Connection updates (status changes & QR generation)
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update

            if (qr) {
                try {
                    const qrDataUrl = await qrcode.toDataURL(qr)
                    device.status = 'QR'
                    device.qrCode = qrDataUrl
                    await deviceRepo.save(device)
                    logger.info(`[WhatsApp Device ${device.name}] QR Code generated.`)
                } catch (err: any) {
                    logger.error(`[WhatsApp Device ${device.name}] QR generation error:`, err.message)
                }
            }

            if (connection === 'open') {
                device.status = 'CONNECTED'
                device.qrCode = undefined
                const rawJid = sock.user?.id
                if (rawJid) {
                    device.phoneNumber = rawJid.split(':')[0].split('@')[0]
                }
                await deviceRepo.save(device)
                logger.info(`[WhatsApp Device ${device.name}] Connected. Number: ${device.phoneNumber || 'unknown'}`)
                this.initializing.delete(deviceId)
            }

            if (connection === 'close') {
                const errorDetail = lastDisconnect?.error?.stack || lastDisconnect?.error?.message || JSON.stringify(lastDisconnect?.error)
                const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut
                logger.warn(`[WhatsApp Device ${device.name}] Connection closed. Reason: ${errorDetail}, reconnecting: ${shouldReconnect}`)

                clearInterval(storeInterval)

                if (shouldReconnect) {
                    // Try to reconnect
                    this.initializing.delete(deviceId)
                    this.clients.delete(deviceId)
                    this.stores.delete(deviceId)
                    setTimeout(() => {
                        this.initSession(deviceId).catch((err) => {
                            logger.error(`Failed to reconnect WhatsApp session ${device.name}:`, err.message)
                        })
                    }, 5000)
                } else {
                    // Logged out
                    device.status = 'DISCONNECTED'
                    device.qrCode = undefined
                    device.phoneNumber = undefined
                    await deviceRepo.save(device)
                    this.initializing.delete(deviceId)
                    this.clients.delete(deviceId)
                    this.stores.delete(deviceId)

                    // Delete auth files on logout
                    if (fs.existsSync(authPath)) {
                        fs.rmSync(authPath, { recursive: true, force: true })
                    }
                    if (fs.existsSync(storePath)) {
                        fs.rmSync(storePath, { force: true })
                    }
                }
            }
        })

        // Credentials save handler
        sock.ev.on('creds.update', saveCreds)

        // Incoming messages handler
        sock.ev.on('messages.upsert', async (m) => {
            if (m.type !== 'notify') return
            for (const msg of m.messages) {
                // Ignore self-sent messages
                if (msg.key.fromMe) continue
                // Ignore status updates
                const remoteJid = msg.key.remoteJid
                if (!remoteJid || remoteJid === 'status@broadcast') continue
                // Ignore group chats
                if (remoteJid.endsWith('@g.us')) continue

                // Extract message body
                const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || ''
                if (body.trim() === '') continue

                // Resolve phone number JID from LID JID if needed
                let phoneJid = remoteJid
                if (remoteJid.endsWith('@lid') && store) {
                    const chats = store.chats.all()
                    const chat = chats.find((c: any) => c.id === remoteJid)
                    if (chat && chat.pnJid) {
                        phoneJid = chat.pnJid
                    } else {
                        const contact = Object.values(store.contacts).find((c: any) => c.lid === remoteJid) as any
                        if (contact && contact.id) {
                            phoneJid = contact.id
                        }
                    }
                }
                const senderNumber = phoneJid.split('@')[0]

                logger.info(`[WhatsApp Device ${device.name}] Message received from ${remoteJid} (resolved PN: ${phoneJid}): ${body}`)

                try {
                    const activeChatbot = await chatbotRepo.findOneBy({ deviceId: device.id, isActive: true })
                    if (!activeChatbot) continue

                    logger.info(`[WhatsApp Chatbot ${activeChatbot.title}] Processing auto-reply for ${senderNumber}`)

                    const mockReq = {
                        params: { id: activeChatbot.chatflowId },
                        protocol: 'http',
                        get: (headerName: string) => {
                            if (headerName === 'host') return 'localhost:3000'
                            return undefined
                        },
                        body: {
                            question: body,
                            chatId: `whatsapp_${senderNumber}`,
                            streaming: false
                        },
                        files: [],
                        headers: {}
                    } as unknown as Request

                    const result = await utilBuildChatflow(mockReq, true)
                    const replyText = result.text || result.output || (typeof result === 'string' ? result : JSON.stringify(result))

                    logger.info(`[WhatsApp Chatbot ${activeChatbot.title}] Replying to ${senderNumber}: ${replyText}`)

                    let targetJid = remoteJid
                    let phoneJid = remoteJid.endsWith('@s.whatsapp.net') ? remoteJid : null
                    let lidJid = remoteJid.endsWith('@lid') ? remoteJid : null
                    let tokenBuffer: Buffer | null = null

                    if (store) {
                        const chats = store.chats.all()
                        const chat = chats.find((c: any) => c.id === remoteJid)
                        if (chat) {
                            if (chat.pnJid) {
                                phoneJid = chat.pnJid
                                targetJid = chat.pnJid
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

                                    // Get both JIDs
                                    if (!lidJid && chat.id.endsWith('@lid')) {
                                        lidJid = chat.id
                                    }

                                    if (lidJid) {
                                        logger.info(`[WhatsApp Chatbot] Subscribing to presence for LID JID ${lidJid} with tcToken...`)
                                        await sock.presenceSubscribe(lidJid, tokenBuffer)
                                    }
                                    if (phoneJid) {
                                        logger.info(`[WhatsApp Chatbot] Subscribing to presence for Phone JID ${phoneJid} with tcToken...`)
                                        await sock.presenceSubscribe(phoneJid, tokenBuffer)
                                    }

                                    logger.info(`[WhatsApp Chatbot] Subscribed to presence. Waiting 2.5s for server propagation...`)
                                    await new Promise((resolve) => setTimeout(resolve, 2500))
                                } catch (e: any) {
                                    logger.warn(`[WhatsApp Chatbot] Failed to subscribe presence: ${e.message}`)
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
                        logger.info(`[WhatsApp Chatbot] Attaching tctoken directly to the message stanza for ${targetJid}`)
                    }

                    const storeJid = lidJid || remoteJid
                    const userJid = sock.authState.creds.me?.id || (sock.user ? sock.user.id : '')
                    const fullMsg = await generateWAMessage(storeJid, { text: replyText }, {
                        logger: pinoLogger,
                        userJid,
                        upload: sock.waUploadToServer
                    } as any)

                    await sock.relayMessage(targetJid, fullMsg.message!, {
                        messageId: fullMsg.key.id || undefined,
                        additionalNodes
                    })

                    sock.ev.emit('messages.upsert', {
                        messages: [fullMsg],
                        type: 'append'
                    })

                    logger.info(`[WhatsApp Chatbot] Message sent successfully to: ${targetJid}`)
                } catch (err: any) {
                    logger.error(`[WhatsApp Chatbot ${device.name}] Error handling auto-reply:`, err.message)
                }
            }
        })

        return sock
    }

    public getClient(deviceId: string): WASocket | undefined {
        return this.clients.get(deviceId)
    }

    public getStore(deviceId: string): any {
        return this.stores.get(deviceId)
    }

    public async closeSession(deviceId: string): Promise<void> {
        const client = this.clients.get(deviceId)
        const store = this.stores.get(deviceId)
        const sessionName = this.sessionNames.get(deviceId)

        if (client) {
            try {
                client.end(undefined)
            } catch (err) {
                // ignore
            }
            this.clients.delete(deviceId)
        }

        if (store && sessionName) {
            try {
                const storePath = path.join(os.homedir(), '.flowise', 'whatsapp_sessions', `store-${sessionName}.json`)
                store.writeToFile(storePath)
            } catch (e) {
                // ignore
            }
            this.stores.delete(deviceId)
        }

        const dataSource = getDataSource()
        const deviceRepo = dataSource.getRepository(WhatsAppDevice)
        const device = await deviceRepo.findOneBy({ id: deviceId })
        if (device) {
            device.status = 'DISCONNECTED'
            device.qrCode = undefined
            device.phoneNumber = undefined
            await deviceRepo.save(device)

            // Delete session directories
            const sessionsDir = path.join(os.homedir(), '.flowise', 'whatsapp_sessions')
            const authPath = path.join(sessionsDir, `auth-${device.sessionName}`)
            const storePath = path.join(sessionsDir, `store-${device.sessionName}.json`)
            if (fs.existsSync(authPath)) {
                fs.rmSync(authPath, { recursive: true, force: true })
            }
            if (fs.existsSync(storePath)) {
                fs.rmSync(storePath, { force: true })
            }
        }
    }
}
