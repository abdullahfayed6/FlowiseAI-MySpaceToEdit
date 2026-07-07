import makeWASocket, { useMultiFileAuthState, DisconnectReason, WASocket, fetchLatestBaileysVersion } from '@whiskeysockets/baileys'
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

// Set WHATSAPP_DEBUG=trace|debug to surface Baileys protocol logs (server nacks, retries, delivery acks).
const pinoLogger: any = pino({ level: process.env.WHATSAPP_DEBUG || 'silent' })

const coerceTimestamp = (ts: any): number => {
    if (typeof ts === 'number') return ts
    if (ts && typeof ts.toNumber === 'function') return ts.toNumber()
    if (ts && typeof ts.low === 'number') return ts.low
    return 0
}

const extractBody = (msg: any): string => {
    return (
        msg?.message?.conversation ||
        msg?.message?.extendedTextMessage?.text ||
        msg?.message?.imageMessage?.caption ||
        msg?.message?.videoMessage?.caption ||
        ''
    )
}

interface ChatRecord {
    id: string
    name?: string
    pnJid?: string
    conversationTimestamp: number
    unreadCount: number
    isPaused?: boolean
}

/**
 * Baileys 7.x removed makeInMemoryStore. This is a small event-driven replacement that keeps just
 * what the inbox needs: a list of private chats and their messages, plus the LID<->PN mapping needed
 * to merge conversations stored under either JID form. Persisted to disk as JSON per session.
 */
export class SimpleStore {
    public chats: Map<string, ChatRecord> = new Map()
    // messages keyed by chat JID -> (messageId -> raw WAMessage)
    public messages: Map<string, Map<string, any>> = new Map()
    // lid -> pn and pn -> lid
    public lidToPn: Map<string, string> = new Map()
    public pnToLid: Map<string, string> = new Map()

    private filePath: string

    constructor(filePath: string) {
        this.filePath = filePath
    }

    private recordMapping(lid?: string | null, pn?: string | null) {
        if (lid && pn && lid.endsWith('@lid') && pn.endsWith('@s.whatsapp.net')) {
            this.lidToPn.set(lid, pn)
            this.pnToLid.set(pn, lid)
            const chat = this.chats.get(lid)
            if (chat) chat.pnJid = pn

            // Sync isPaused flag between LID and PN
            const lidChat = this.chats.get(lid)
            const pnChat = this.chats.get(pn)
            if (lidChat && pnChat) {
                const isPaused = lidChat.isPaused || pnChat.isPaused || false
                lidChat.isPaused = isPaused
                pnChat.isPaused = isPaused
            } else if (lidChat && !pnChat) {
                if (lidChat.isPaused) {
                    this.upsertChat(pn, { isPaused: true })
                }
            } else if (!lidChat && pnChat) {
                if (pnChat.isPaused) {
                    this.upsertChat(lid, { isPaused: true })
                }
            }
        }
    }

    /** Public entry for recording a LID<->PN mapping resolved outside the event stream. */
    public recordLidMapping(lid: string, pn: string) {
        this.recordMapping(lid, pn)
    }

    public pauseChat(chatId: string, isPaused: boolean) {
        const update = (id: string) => {
            const existing = this.chats.get(id)
            if (existing) {
                existing.isPaused = isPaused
            } else {
                this.chats.set(id, {
                    id: id,
                    conversationTimestamp: Math.floor(Date.now() / 1000),
                    unreadCount: 0,
                    isPaused: isPaused
                })
            }
        }

        update(chatId)

        // If there's an alias mapping, update it too
        const pn = chatId.endsWith('@s.whatsapp.net') ? chatId : this.lidToPn.get(chatId)
        const lid = chatId.endsWith('@lid') ? chatId : this.pnToLid.get(chatId)

        if (pn) update(pn)
        if (lid) update(lid)

        this.save()
    }

    private upsertChat(id: string, patch: Partial<ChatRecord> = {}) {
        if (!id || id === 'status@broadcast' || id.endsWith('@g.us') || id.endsWith('@newsletter')) return
        const existing = this.chats.get(id)
        if (existing) {
            Object.assign(existing, {
                ...patch,
                conversationTimestamp: Math.max(existing.conversationTimestamp, patch.conversationTimestamp || 0)
            })
        } else {
            this.chats.set(id, {
                id,
                name: patch.name,
                pnJid: patch.pnJid,
                conversationTimestamp: patch.conversationTimestamp || 0,
                unreadCount: patch.unreadCount || 0,
                isPaused: patch.isPaused || false
            })
        }
    }

    private addMessage(msg: any) {
        const jid = msg?.key?.remoteJid
        const id = msg?.key?.id
        if (!jid || !id) return
        if (jid === 'status@broadcast' || jid.endsWith('@g.us') || jid.endsWith('@newsletter')) return

        // Baileys 7.x exposes the phone JID alongside a LID via key.remoteJidAlt. Capture it so the
        // inbox can display the real number instead of the opaque @lid id.
        const alt = msg?.key?.remoteJidAlt
        if (jid.endsWith('@lid') && alt?.endsWith('@s.whatsapp.net')) {
            this.recordMapping(jid, alt)
        } else if (jid.endsWith('@s.whatsapp.net') && alt?.endsWith('@lid')) {
            this.recordMapping(alt, jid)
        }

        let bucket = this.messages.get(jid)
        if (!bucket) {
            bucket = new Map()
            this.messages.set(jid, bucket)
        }
        // Ensure a timestamp: outgoing replies are appended without messageTimestamp, which would
        // sort them to the very top (epoch 0) with no time shown. Fall back to "now".
        let ts = coerceTimestamp(msg.messageTimestamp)
        if (!ts) {
            ts = Math.floor(Date.now() / 1000)
            msg.messageTimestamp = ts
        }

        // Merge so a later status/content update doesn't wipe the body
        const prev = bucket.get(id)
        bucket.set(id, prev ? { ...prev, ...msg, message: msg.message || prev.message } : msg)

        this.upsertChat(jid, { conversationTimestamp: ts })
    }

    /** Bind to all socket events that feed the store. */
    bind(ev: any) {
        ev.on('messaging-history.set', ({ chats, messages, lidPnMappings }: any) => {
            for (const m of lidPnMappings || []) this.recordMapping(m.lid, m.pn)
            for (const c of chats || []) {
                this.upsertChat(c.id, {
                    name: c.name || c.subject,
                    conversationTimestamp: coerceTimestamp(c.conversationTimestamp),
                    unreadCount: c.unreadCount || 0
                })
            }
            for (const msg of messages || []) this.addMessage(msg)
        })

        ev.on('chats.upsert', (chats: any[]) => {
            for (const c of chats) {
                this.upsertChat(c.id, {
                    name: c.name,
                    conversationTimestamp: coerceTimestamp(c.conversationTimestamp),
                    unreadCount: c.unreadCount || 0
                })
            }
        })

        ev.on('chats.update', (updates: any[]) => {
            for (const u of updates) {
                if (!u.id) continue
                const patch: Partial<ChatRecord> = {}
                if (u.name !== undefined) patch.name = u.name
                if (u.conversationTimestamp !== undefined) patch.conversationTimestamp = coerceTimestamp(u.conversationTimestamp)
                if (u.unreadCount !== undefined) patch.unreadCount = u.unreadCount
                this.upsertChat(u.id, patch)
            }
        })

        ev.on('chats.delete', (ids: string[]) => {
            for (const id of ids) {
                this.chats.delete(id)
                this.messages.delete(id)
            }
        })

        ev.on('contacts.upsert', (contacts: any[]) => {
            for (const c of contacts) {
                if (c.id) this.upsertChat(c.id, { name: c.name || c.notify })
                this.recordMapping(c.lid, c.id)
            }
        })

        ev.on('contacts.update', (updates: any[]) => {
            for (const u of updates) {
                if (u.id && (u.name || u.notify)) this.upsertChat(u.id, { name: u.name || u.notify })
                this.recordMapping(u.lid, u.id)
            }
        })

        ev.on('lid-mapping.update', (m: any) => {
            this.recordMapping(m.lid, m.pn)
        })

        ev.on('messages.upsert', ({ messages }: any) => {
            for (const msg of messages || []) {
                this.addMessage(msg)
                if (msg?.pushName && msg?.key?.remoteJid && !msg.key.fromMe) {
                    const chat = this.chats.get(msg.key.remoteJid)
                    if (chat && !chat.name) chat.name = msg.pushName
                }
            }
        })

        ev.on('messages.update', (updates: any[]) => {
            for (const u of updates) {
                const jid = u.key?.remoteJid
                const id = u.key?.id
                if (!jid || !id) continue
                const bucket = this.messages.get(jid)
                const existing = bucket?.get(id)
                if (existing && u.update) Object.assign(existing, u.update)
            }
        })
    }

    /** Does this chat (under any alias key) have at least one stored message? */
    private hasMessages(c: ChatRecord): boolean {
        const keys = [c.id]
        const pn = c.pnJid || this.lidToPn.get(c.id)
        if (pn) keys.push(pn)
        if (c.id.endsWith('@s.whatsapp.net')) {
            const lid = this.pnToLid.get(c.id)
            if (lid) keys.push(lid)
        }
        return keys.some((k) => (this.messages.get(k)?.size || 0) > 0)
    }

    /**
     * Private chats that actually have messages, deduped so a contact known under both its @lid and
     * @s.whatsapp.net JIDs shows as a single row. Display label is always the phone number (not the
     * saved contact name). The row's `id` prefers the phone JID so replies target it directly.
     */
    listChats() {
        const groups = new Map<string, { id: string; number: string; unreadCount: number; timestamp: number }>()

        for (const c of this.chats.values()) {
            if (!(c.id.endsWith('@lid') || c.id.endsWith('@s.whatsapp.net'))) continue
            if (!this.hasMessages(c)) continue

            const pn = c.pnJid || this.lidToPn.get(c.id)
            // Group key = phone number when known, else the raw id (LID with no known PN).
            const number = (pn || c.id).split('@')[0]
            const groupKey = pn ? pn : c.id
            const preferredId = pn || c.id

            const existing = groups.get(groupKey)
            if (existing) {
                existing.unreadCount += c.unreadCount || 0
                existing.timestamp = Math.max(existing.timestamp, c.conversationTimestamp || 0)
                // Prefer a phone JID as the row id if we now have one
                if (preferredId.endsWith('@s.whatsapp.net')) existing.id = preferredId
            } else {
                groups.set(groupKey, {
                    id: preferredId,
                    number,
                    unreadCount: c.unreadCount || 0,
                    timestamp: c.conversationTimestamp || 0
                })
            }
        }

        return Array.from(groups.values())
            .map((g) => {
                const pn = g.id.endsWith('@s.whatsapp.net') ? g.id : this.lidToPn.get(g.id) || undefined
                const lid = g.id.endsWith('@lid') ? g.id : this.pnToLid.get(g.id) || undefined
                const isPaused =
                    (lid && this.chats.get(lid)?.isPaused) ||
                    (pn && this.chats.get(pn)?.isPaused) ||
                    this.chats.get(g.id)?.isPaused ||
                    false
                return {
                    id: g.id,
                    name: g.number, // always show the number, never the contact name
                    unreadCount: g.unreadCount,
                    timestamp: g.timestamp,
                    isPaused: isPaused
                }
            })
            .sort((a, b) => b.timestamp - a.timestamp)
    }

    /** Messages for a chat, merging any LID/PN alias keys, sorted oldest first. */
    listMessages(chatId: string) {
        const keys = new Set<string>([chatId])
        const chat = this.chats.get(chatId)
        if (chat?.pnJid) keys.add(chat.pnJid)
        if (chatId.endsWith('@lid')) {
            const pn = this.lidToPn.get(chatId)
            if (pn) keys.add(pn)
        } else if (chatId.endsWith('@s.whatsapp.net')) {
            const lid = this.pnToLid.get(chatId)
            if (lid) keys.add(lid)
        }

        const seen = new Set<string>()
        const out: any[] = []
        for (const key of keys) {
            const bucket = this.messages.get(key)
            if (!bucket) continue
            for (const msg of bucket.values()) {
                const id = msg.key?.id
                if (id && seen.has(id)) continue
                if (id) seen.add(id)
                out.push({
                    id,
                    body: extractBody(msg),
                    fromMe: msg.key?.fromMe || false,
                    timestamp: coerceTimestamp(msg.messageTimestamp)
                })
            }
        }
        return out.sort((a, b) => a.timestamp - b.timestamp)
    }

    deleteChat(chatId: string) {
        this.chats.delete(chatId)
        this.messages.delete(chatId)
    }

    save() {
        try {
            const dir = path.dirname(this.filePath)
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
            const data = {
                chats: Array.from(this.chats.entries()),
                messages: Array.from(this.messages.entries()).map(([jid, bucket]) => [jid, Array.from(bucket.entries())]),
                lidToPn: Array.from(this.lidToPn.entries())
            }
            fs.writeFileSync(this.filePath, JSON.stringify(data), 'utf8')
        } catch (e: any) {
            logger.warn(`[WhatsApp] Failed to save store: ${e.message}`)
        }
    }

    load() {
        try {
            if (!fs.existsSync(this.filePath)) return
            const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
            for (const [id, chat] of data.chats || []) this.chats.set(id, chat)
            for (const [jid, entries] of data.messages || []) this.messages.set(jid, new Map(entries))
            for (const [lid, pn] of data.lidToPn || []) {
                this.lidToPn.set(lid, pn)
                this.pnToLid.set(pn, lid)
            }
            logger.info(`[WhatsApp] Loaded store: ${this.chats.size} chats, ${this.messages.size} conversations.`)
        } catch (e: any) {
            logger.warn(`[WhatsApp] Failed to load store: ${e.message}`)
        }
    }
}

export class WhatsAppSessionManager {
    private static instance: WhatsAppSessionManager
    private clients: Map<string, WASocket> = new Map()
    private stores: Map<string, SimpleStore> = new Map()
    private sessionNames: Map<string, string> = new Map()
    private initializing: Set<string> = new Set()

    private constructor() {
        const cleanup = () => {
            logger.info('[WhatsApp] Process exiting. Saving all active session stores...')
            for (const store of this.stores.values()) {
                try {
                    store.save()
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
            const dataSource = getDataSource()
            const deviceRepo = dataSource.getRepository(WhatsAppDevice)
            const devices = await deviceRepo.find()

            for (const device of devices) {
                if (device.status === 'CONNECTED') {
                    try {
                        logger.info(`[WhatsApp] Restoring session for device ${device.name} sequentially...`)
                        await this.initSession(device.id)
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

        // eslint-disable-next-line react-hooks/rules-of-hooks
        const { state, saveCreds } = await useMultiFileAuthState(authPath)

        const store = new SimpleStore(storePath)
        store.load()
        this.stores.set(deviceId, store)

        // Fetch latest WhatsApp Web version to prevent connection failure rejects
        let version: any
        try {
            const fetched = await fetchLatestBaileysVersion()
            version = fetched.version
            logger.info(`[WhatsApp Device ${device.name}] Using WhatsApp Web version: ${version.join('.')}`)
        } catch (e: any) {
            logger.warn(`[WhatsApp Device ${device.name}] Failed to fetch latest WA version:`, e.message)
        }

        const sock = makeWASocket({
            version,
            auth: state,
            logger: pinoLogger,
            browser: ['Windows', 'Chrome', '120.0.0'],
            markOnlineOnConnect: false,
            syncFullHistory: true
        })

        store.bind(sock.ev)

        this.clients.set(deviceId, sock)

        const storeInterval = setInterval(() => store.save(), 10000)

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
                store.save()

                if (shouldReconnect) {
                    this.initializing.delete(deviceId)
                    this.clients.delete(deviceId)
                    this.stores.delete(deviceId)
                    setTimeout(() => {
                        this.initSession(deviceId).catch((err) => {
                            logger.error(`Failed to reconnect WhatsApp session ${device.name}:`, err.message)
                        })
                    }, 5000)
                } else {
                    device.status = 'DISCONNECTED'
                    device.qrCode = undefined
                    device.phoneNumber = undefined
                    await deviceRepo.save(device)
                    this.initializing.delete(deviceId)
                    this.clients.delete(deviceId)
                    this.stores.delete(deviceId)

                    if (fs.existsSync(authPath)) {
                        fs.rmSync(authPath, { recursive: true, force: true })
                    }
                    if (fs.existsSync(storePath)) {
                        fs.rmSync(storePath, { force: true })
                    }
                }
            }
        })

        sock.ev.on('creds.update', saveCreds)

        // Delivery-status tracking. status: 1=PENDING 2=SERVER_ACK 3=DELIVERY_ACK 4=READ.
        sock.ev.on('messages.update', (updates) => {
            for (const u of updates) {
                if (u.update?.status !== undefined) {
                    logger.info(
                        `[WhatsApp Device ${device.name}] Delivery update for ${u.key?.remoteJid} (id: ${u.key?.id}): status=${u.update.status}`
                    )
                }
            }
        })

        // Incoming messages -> chatbot auto-reply
        sock.ev.on('messages.upsert', async (m) => {
            if (m.type !== 'notify') return
            for (const msg of m.messages) {
                const remoteJid = msg.key.remoteJid
                if (!remoteJid || remoteJid === 'status@broadcast') continue
                if (remoteJid.endsWith('@g.us') || remoteJid.endsWith('@newsletter')) continue

                if (msg.key.fromMe) {
                    logger.info(`[WhatsApp] Outgoing message detected from connected phone/web to ${remoteJid}. Auto-pausing AI.`)
                    store.pauseChat(remoteJid, true)
                    continue
                }

                const lid = remoteJid.endsWith('@lid') ? remoteJid : store.pnToLid.get(remoteJid)
                const pn = remoteJid.endsWith('@s.whatsapp.net') ? remoteJid : store.lidToPn.get(remoteJid)
                const isPaused =
                    (lid ? store.chats.get(lid)?.isPaused : false) ||
                    (pn ? store.chats.get(pn)?.isPaused : false) ||
                    store.chats.get(remoteJid)?.isPaused ||
                    false

                if (isPaused) {
                    logger.info(`[WhatsApp Chatbot] Skipping auto-reply for ${remoteJid} because AI is paused for this chat.`)
                    continue
                }

                const body = extractBody(msg)
                if (body.trim() === '') continue

                const senderId = remoteJid.split('@')[0]
                logger.info(`[WhatsApp Device ${device.name}] Message from ${remoteJid}: ${body}`)

                // Resolve the real phone number for a @lid sender via Baileys' native LID mapping,
                // so the inbox shows the number rather than the opaque hidden id. Best-effort.
                if (remoteJid.endsWith('@lid') && !store.lidToPn.has(remoteJid)) {
                    try {
                        const pn = await (sock as any).signalRepository?.lidMapping?.getPNForLID?.(remoteJid)
                        if (pn && typeof pn === 'string' && pn.endsWith('@s.whatsapp.net')) {
                            store.recordLidMapping(remoteJid, pn)
                        }
                    } catch (e: any) {
                        logger.warn(`[WhatsApp] getPNForLID failed for ${remoteJid}: ${e.message}`)
                    }
                }

                try {
                    const activeChatbot = await chatbotRepo.findOneBy({ deviceId: device.id, isActive: true })
                    if (!activeChatbot) continue

                    logger.info(`[WhatsApp Chatbot ${activeChatbot.title}] Processing auto-reply for ${senderId}`)

                    const mockReq = {
                        params: { id: activeChatbot.chatflowId },
                        protocol: 'http',
                        get: (headerName: string) => {
                            if (headerName === 'host') return 'localhost:3000'
                            return undefined
                        },
                        body: {
                            question: body,
                            chatId: `whatsapp_${senderId}`,
                            streaming: false
                        },
                        files: [],
                        headers: {}
                    } as unknown as Request

                    const result = await utilBuildChatflow(mockReq, true)
                    const replyText = result.text || result.output || (typeof result === 'string' ? result : JSON.stringify(result))

                    logger.info(`[WhatsApp Chatbot ${activeChatbot.title}] Replying to ${remoteJid}: ${replyText}`)

                    // Baileys 7.x resolves LID addressing, attaches tctoken/cstoken and handles the
                    // reachout-timelock natively — so a plain reply on the incoming JID is delivered.
                    const sent = await sock.sendMessage(remoteJid, { text: replyText })
                    logger.info(`[WhatsApp Chatbot] Reply sent to ${remoteJid} (id: ${sent?.key?.id}, status: ${sent?.status})`)
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

    public getStore(deviceId: string): SimpleStore | undefined {
        return this.stores.get(deviceId)
    }

    public async closeSession(deviceId: string): Promise<void> {
        const client = this.clients.get(deviceId)
        const store = this.stores.get(deviceId)

        if (client) {
            try {
                client.end(undefined)
            } catch (err) {
                // ignore
            }
            this.clients.delete(deviceId)
        }

        if (store) {
            try {
                store.save()
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
