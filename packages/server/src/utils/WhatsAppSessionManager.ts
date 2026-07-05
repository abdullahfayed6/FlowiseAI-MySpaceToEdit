import { Client, LocalAuth } from 'whatsapp-web.js'
import * as qrcode from 'qrcode'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { Request } from 'express'
import { getDataSource } from '../DataSource'
import { WhatsAppDevice } from '../database/entities/WhatsAppDevice'
import { WhatsAppChatbot } from '../database/entities/WhatsAppChatbot'
import { utilBuildChatflow } from './buildChatflow'
import logger from './logger'

function findPuppeteerChrome(): string | undefined {
    const puppeteerCache = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome')
    if (!fs.existsSync(puppeteerCache)) return undefined
    try {
        const versions = fs.readdirSync(puppeteerCache)
        for (const version of versions) {
            const exePath = path.join(puppeteerCache, version, 'chrome-win64', 'chrome.exe')
            if (fs.existsSync(exePath)) {
                return exePath
            }
        }
    } catch (e) {
        logger.error('Error finding puppeteer chrome:', e)
    }
    return undefined
}

export class WhatsAppSessionManager {
    private static instance: WhatsAppSessionManager
    private clients: Map<string, Client> = new Map()
    private initializing: Set<string> = new Set()

    private constructor() {}

    public static getInstance(): WhatsAppSessionManager {
        if (!WhatsAppSessionManager.instance) {
            WhatsAppSessionManager.instance = new WhatsAppSessionManager()
        }
        return WhatsAppSessionManager.instance
    }

    public async initializeAllSessions(): Promise<void> {
        try {
            const dataSource = getDataSource()
            const deviceRepo = dataSource.getRepository(WhatsAppDevice)
            const devices = await deviceRepo.find()

            for (const device of devices) {
                if (device.status === 'CONNECTED') {
                    // Try to restore session
                    this.initSession(device.id).catch((err) => {
                        logger.error(`Failed to restore WhatsApp session ${device.name}:`, err)
                    })
                } else if (device.status === 'QR' || device.status === 'INITIALIZING') {
                    // Reset stuck devices on startup
                    device.status = 'DISCONNECTED'
                    device.qrCode = undefined
                    await deviceRepo.save(device)
                }
            }
        } catch (error) {
            logger.error('Error initializing WhatsApp sessions:', error)
        }
    }

    public async initSession(deviceId: string): Promise<Client | undefined> {
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

        device.status = 'INITIALIZING'
        device.qrCode = undefined
        await deviceRepo.save(device)

        const chromePath = findPuppeteerChrome()
        const puppeteerConfig: any = {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1280,720']
        }
        if (chromePath) {
            puppeteerConfig.executablePath = chromePath
        }

        const client = new Client({
            authStrategy: new LocalAuth({
                clientId: device.sessionName,
                dataPath: path.join(os.homedir(), '.flowise', 'whatsapp_sessions')
            }),
            webVersionCache: {
                type: 'remote',
                remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/%VERSION%.html'
            },
            puppeteer: puppeteerConfig
        })

        this.clients.set(deviceId, client)

        client.on('qr', async (qr) => {
            try {
                const qrDataUrl = await qrcode.toDataURL(qr)
                device.status = 'QR'
                device.qrCode = qrDataUrl
                await deviceRepo.save(device)
                logger.info(`[WhatsApp Device ${device.name}] QR Code generated.`)
            } catch (err: any) {
                logger.error(`[WhatsApp Device ${device.name}] QR generation error:`, err.message)
            }
        })

        client.on('authenticated', async () => {
            device.status = 'CONNECTED'
            device.qrCode = undefined
            await deviceRepo.save(device)
            logger.info(`[WhatsApp Device ${device.name}] Authenticated. Syncing chats...`)
        })

        client.on('loading_screen', (percent, message) => {
            logger.info(`[WhatsApp Device ${device.name}] LOADING: ${percent}% - ${message}`)
        })

        client.on('ready', async () => {
            const number = client.info?.me?.user || client.info?.wid?.user
            device.status = 'CONNECTED'
            device.qrCode = undefined
            if (number) {
                device.phoneNumber = number
            }
            await deviceRepo.save(device)
            logger.info(`[WhatsApp Device ${device.name}] Ready. Number: ${number || 'unknown'}`)
            this.initializing.delete(deviceId)
        })

        client.on('auth_failure', async (msg) => {
            device.status = 'DISCONNECTED'
            device.qrCode = undefined
            await deviceRepo.save(device)
            logger.error(`[WhatsApp Device ${device.name}] Auth failure:`, msg)
            this.initializing.delete(deviceId)
        })

        client.on('disconnected', async (reason) => {
            device.status = 'DISCONNECTED'
            device.qrCode = undefined
            device.phoneNumber = undefined
            await deviceRepo.save(device)
            logger.info(`[WhatsApp Device ${device.name}] Disconnected:`, reason)
            this.initializing.delete(deviceId)
        })

        client.on('message', async (msg) => {
            // Defensively update status if it's stuck
            if (device.status !== 'CONNECTED') {
                device.status = 'CONNECTED'
                device.qrCode = undefined
                await deviceRepo.save(device)
                this.initializing.delete(deviceId)
            }
            logger.info(`[WhatsApp Device ${device.name}] RAW MESSAGE EVENT: ${msg.body} from ${msg.from}`)
            // Ignore group chats
            if (msg.from.endsWith('@g.us') || msg.to.endsWith('@g.us')) return
            // Ignore self-sent messages to avoid loops
            if (msg.fromMe) return
            // Ignore empty messages (e.g., system messages or some media without captions)
            if (!msg.body || msg.body.trim() === '') return

            try {
                const activeChatbot = await chatbotRepo.findOneBy({ deviceId: device.id, isActive: true })
                if (!activeChatbot) return

                const senderNumber = msg.from.replace('@c.us', '')
                logger.info(`[WhatsApp Chatbot ${activeChatbot.title}] Incoming message from ${senderNumber}: ${msg.body}`)

                // Construct mock Express request to run the prediction flowise builder
                const mockReq = {
                    params: { id: activeChatbot.chatflowId },
                    protocol: 'http',
                    get: (headerName: string) => {
                        if (headerName === 'host') return 'localhost:3000'
                        return undefined
                    },
                    body: {
                        question: msg.body,
                        chatId: `whatsapp_${senderNumber}`,
                        streaming: false
                    },
                    files: [],
                    headers: {}
                } as unknown as Request

                const result = await utilBuildChatflow(mockReq, true)
                const replyText = result.text || result.output || (typeof result === 'string' ? result : JSON.stringify(result))

                logger.info(`[WhatsApp Chatbot ${activeChatbot.title}] Replying to ${senderNumber}: ${replyText}`)
                await client.sendMessage(msg.from, replyText)
            } catch (err: any) {
                logger.error(`[WhatsApp Chatbot ${device.name}] Error handling auto-reply:`, err)
            }
        })

        client
            .initialize()
            .catch(async (err) => {
                device.status = 'DISCONNECTED'
                await deviceRepo.save(device)
                logger.error(`[WhatsApp Device ${device.name}] Initialization failed:`, err)
                try {
                    await client.destroy()
                } catch (e) {}
                this.clients.delete(deviceId)
            })
            .finally(() => {
                this.initializing.delete(deviceId)
            })

        return client
    }

    public getClient(deviceId: string): Client | undefined {
        return this.clients.get(deviceId)
    }

    public async closeSession(deviceId: string): Promise<void> {
        const client = this.clients.get(deviceId)
        if (client) {
            try {
                await client.destroy()
            } catch (err) {
                logger.error(`Error destroying WhatsApp client session ${deviceId}:`, err)
            }
            this.clients.delete(deviceId)
        }

        const dataSource = getDataSource()
        const deviceRepo = dataSource.getRepository(WhatsAppDevice)
        const device = await deviceRepo.findOneBy({ id: deviceId })
        if (device) {
            device.status = 'DISCONNECTED'
            device.qrCode = undefined
            device.phoneNumber = undefined
            await deviceRepo.save(device)
        }
    }
}
