import makeWASocket, { useMultiFileAuthState, DisconnectReason, WASocket, fetchLatestBaileysVersion } from '@whiskeysockets/baileys'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { Request } from 'express'

// Suppress verbose Baileys "Closing session: SessionEntry" console.log outputs
const originalConsoleLog = console.log
console.log = function (...args: any[]) {
    if (args[0] && typeof args[0] === 'string' && args[0].includes('Closing session: SessionEntry')) {
        return
    }
    originalConsoleLog.apply(console, args)
}
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
    if (typeof ts === 'bigint') return Number(ts)
    if (typeof ts === 'string') {
        const parsed = parseInt(ts, 10)
        return isNaN(parsed) ? 0 : parsed
    }
    if (ts && typeof ts.toNumber === 'function') return ts.toNumber()
    if (ts && typeof ts.low === 'number') return ts.low
    return 0
}

const extractBody = (msg: any): string => {
    const text =
        msg?.message?.conversation ||
        msg?.message?.extendedTextMessage?.text ||
        msg?.message?.imageMessage?.caption ||
        msg?.message?.videoMessage?.caption ||
        msg?.message?.documentMessage?.caption ||
        msg?.message?.documentWithCaptionMessage?.message?.documentMessage?.caption ||
        ''

    if (text) return text

    // Fallbacks for media without caption
    if (msg?.message?.imageMessage) return '📷 Photo'
    if (msg?.message?.videoMessage) return '🎥 Video'
    if (msg?.message?.audioMessage) return '🎵 Audio message'
    if (msg?.message?.documentMessage) {
        const filename = msg.message.documentMessage.fileName || 'document'
        return `📄 Document: ${filename}`
    }
    if (msg?.message?.documentWithCaptionMessage?.message?.documentMessage) {
        const filename = msg.message.documentWithCaptionMessage.message.documentMessage.fileName || 'document'
        return `📄 Document: ${filename}`
    }

    return ''
}

interface ChatRecord {
    id: string
    name?: string
    pnJid?: string
    conversationTimestamp: number
    unreadCount: number
    isPaused?: boolean
    lastFollowUpSentForMsgId?: string
    lastFollowUpTimestamp?: number
    lastFollowUpTriggerId?: string
    lastOutsideHoursMsg?: number // Unix timestamp: last time we sent outside-hours message
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
    // Unix timestamp (seconds): only show chats/messages that arrived after this time
    public connectedAt: number = 0
    private messageSeq: number = 0

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

        if (!msg._seq) {
            this.messageSeq++
            msg._seq = this.messageSeq
        }

        // Merge so a later status/content update doesn't wipe the body
        const prev = bucket.get(id)
        bucket.set(id, prev ? { ...prev, ...msg, message: msg.message || prev.message, _seq: msg._seq || prev._seq } : msg)

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

    /**
     * Does this chat have at least one stored message that arrived after connectedAt?
     * This ensures the inbox only shows chats that contacted the bot after linking.
     */
    private hasPostConnectionMessages(c: ChatRecord): boolean {
        const keys = [c.id]
        const pn = c.pnJid || this.lidToPn.get(c.id)
        if (pn) keys.push(pn)
        if (c.id.endsWith('@s.whatsapp.net')) {
            const lid = this.pnToLid.get(c.id)
            if (lid) keys.push(lid)
        }
        return keys.some((k) => {
            const bucket = this.messages.get(k)
            if (!bucket || bucket.size === 0) return false
            // Check if any message in this bucket is after connectedAt
            for (const msg of bucket.values()) {
                const ts = coerceTimestamp(msg.messageTimestamp)
                if (ts >= this.connectedAt) return true
            }
            return false
        })
    }

    /**
     * Private chats that actually have messages AFTER connectedAt, deduped so a contact known under
     * both its @lid and @s.whatsapp.net JIDs shows as a single row. Display label is always the
     * phone number (not the saved contact name). The row's `id` prefers the phone JID so replies
     * target it directly.
     */
    listChats() {
        const groups = new Map<string, { id: string; number: string; unreadCount: number; timestamp: number }>()

        for (const c of this.chats.values()) {
            if (!(c.id.endsWith('@lid') || c.id.endsWith('@s.whatsapp.net'))) continue
            if (!this.hasPostConnectionMessages(c)) continue

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

    /** Messages for a chat, merging any LID/PN alias keys, sorted oldest first.
     *  Only returns messages that arrived AFTER connectedAt.
     */
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
                const ts = coerceTimestamp(msg.messageTimestamp)
                // Filter: only show messages after the bot was connected
                if (ts < this.connectedAt) continue
                out.push({
                    id,
                    body: extractBody(msg),
                    fromMe: msg.key?.fromMe || false,
                    timestamp: ts,
                    _seq: msg._seq || 0
                })
            }
        }
        return out.sort((a, b) => {
            if (a.timestamp !== b.timestamp) {
                return a.timestamp - b.timestamp
            }
            return a._seq - b._seq
        })
    }

    getRawMessage(chatId: string, messageId: string): any {
        const keys = [chatId]
        const pn = chatId.endsWith('@s.whatsapp.net') ? chatId : this.lidToPn.get(chatId)
        if (pn && !keys.includes(pn)) keys.push(pn)
        const lid = chatId.endsWith('@lid') ? chatId : this.pnToLid.get(chatId)
        if (lid && !keys.includes(lid)) keys.push(lid)

        for (const key of keys) {
            const bucket = this.messages.get(key)
            if (bucket) {
                const msg = bucket.get(messageId)
                if (msg) return msg
            }
        }
        return null
    }

    deleteChat(chatId: string) {
        this.chats.delete(chatId)
        this.messages.delete(chatId)

        const pn = chatId.endsWith('@s.whatsapp.net') ? chatId : this.lidToPn.get(chatId)
        const lid = chatId.endsWith('@lid') ? chatId : this.pnToLid.get(chatId)

        if (pn) {
            this.chats.delete(pn)
            this.messages.delete(pn)
            this.pnToLid.delete(pn)
        }
        if (lid) {
            this.chats.delete(lid)
            this.messages.delete(lid)
            this.lidToPn.delete(lid)
        }
        this.save()
    }

    save() {
        try {
            const dir = path.dirname(this.filePath)
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
            const data = {
                chats: Array.from(this.chats.entries()),
                messages: Array.from(this.messages.entries()).map(([jid, bucket]) => [jid, Array.from(bucket.entries())]),
                lidToPn: Array.from(this.lidToPn.entries()),
                connectedAt: this.connectedAt
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
            if (data.connectedAt) this.connectedAt = data.connectedAt

            // Reconstruct and assign message sequence numbers for chronological stability
            let maxSeq = 0
            for (const bucket of this.messages.values()) {
                for (const msg of bucket.values()) {
                    if (msg._seq) {
                        maxSeq = Math.max(maxSeq, msg._seq)
                    }
                }
            }
            for (const bucket of this.messages.values()) {
                const sortedMsgs = Array.from(bucket.values()).sort((a, b) => {
                    const tsA = coerceTimestamp(a.messageTimestamp)
                    const tsB = coerceTimestamp(b.messageTimestamp)
                    return tsA - tsB
                })
                for (const msg of sortedMsgs) {
                    if (!msg._seq) {
                        maxSeq++
                        msg._seq = maxSeq
                    }
                }
            }
            this.messageSeq = maxSeq

            logger.info(
                `[WhatsApp] Loaded store: ${this.chats.size} chats, ${this.messages.size} conversations, connectedAt: ${this.connectedAt}`
            )
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
    private followUpTimer: NodeJS.Timeout | null = null

    // Anti-ban: Rate limiting
    private rateLimiter: Map<string, { count: number; resetTime: number }> = new Map()
    private readonly MAX_MESSAGES_PER_MINUTE = 8
    private readonly MIN_REPLY_DELAY_MS = 2000 // 2 seconds minimum
    private readonly MAX_REPLY_DELAY_MS = 5000 // 5 seconds maximum

    // Anti-ban: Exponential backoff for reconnections
    private reconnectAttempts: Map<string, number> = new Map()
    private readonly MAX_RECONNECT_DELAY_MS = 300000 // 5 minutes max

    // Anti-ban: Message queue to serialize outgoing replies
    private messageQueue: Map<string, Array<{ remoteJid: string; text: string; resolve: () => void }>> = new Map()
    private processingQueue: Set<string> = new Set()

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

        // Start background AI follow-up checker
        this.startFollowUpChecker()
    }

    /**
     * Anti-ban: Random delay between MIN and MAX to simulate human typing speed.
     */
    private randomDelay(): number {
        return Math.floor(Math.random() * (this.MAX_REPLY_DELAY_MS - this.MIN_REPLY_DELAY_MS + 1)) + this.MIN_REPLY_DELAY_MS
    }

    /**
     * Anti-ban: Check if we can send a message (rate limiting).
     * Returns true if under the limit, false if we should wait.
     */
    private canSendMessage(deviceId: string): boolean {
        const now = Date.now()
        const limiter = this.rateLimiter.get(deviceId)

        if (!limiter || now > limiter.resetTime) {
            this.rateLimiter.set(deviceId, { count: 1, resetTime: now + 60000 })
            return true
        }

        if (limiter.count < this.MAX_MESSAGES_PER_MINUTE) {
            limiter.count++
            return true
        }

        return false
    }

    /**
     * Anti-ban: Simulate typing indicator before sending a reply.
     * Duration scales with message length to appear natural.
     */
    private async simulateTyping(sock: WASocket, remoteJid: string, messageLength: number): Promise<void> {
        try {
            // Calculate typing duration: ~1 second per 50 characters, min 1.5s, max 4s
            const typingDuration = Math.min(Math.max(Math.ceil(messageLength / 50) * 1000, 1500), 4000)

            await sock.presenceSubscribe(remoteJid)
            await new Promise((resolve) => setTimeout(resolve, 300)) // Small gap before "composing"
            await sock.sendPresenceUpdate('composing', remoteJid)
            await new Promise((resolve) => setTimeout(resolve, typingDuration))
            await sock.sendPresenceUpdate('paused', remoteJid)
        } catch (err: any) {
            // Non-critical: if presence fails, still send the message
            logger.debug(`[WhatsApp Anti-Ban] Typing simulation failed for ${remoteJid}: ${err.message}`)
        }
    }

    /**
     * Business Hours: Check if the current time is within the configured business hours.
     * Returns true if business hours are disabled (always available) or current time is within range.
     */
    private isWithinBusinessHours(chatbot: WhatsAppChatbot): boolean {
        if (!chatbot.businessHoursEnabled) return true

        const now = new Date()
        const currentMinutes = now.getHours() * 60 + now.getMinutes()

        const [startH, startM] = (chatbot.businessHoursStart || '09:00').split(':').map(Number)
        const [endH, endM] = (chatbot.businessHoursEnd || '22:00').split(':').map(Number)
        const startMinutes = startH * 60 + startM
        const endMinutes = endH * 60 + endM

        // Handle overnight ranges (e.g., 22:00 - 06:00)
        if (startMinutes <= endMinutes) {
            return currentMinutes >= startMinutes && currentMinutes <= endMinutes
        } else {
            return currentMinutes >= startMinutes || currentMinutes <= endMinutes
        }
    }

    public static getInstance(): WhatsAppSessionManager {
        if (!WhatsAppSessionManager.instance) {
            WhatsAppSessionManager.instance = new WhatsAppSessionManager()
        }
        return WhatsAppSessionManager.instance
    }

    private async ensureDatabaseColumns() {
        try {
            const dataSource = getDataSource()
            // Add isFollowUpEnabled
            try {
                await dataSource.query('ALTER TABLE whatsapp_chatbot ADD COLUMN isFollowUpEnabled BOOLEAN DEFAULT 0')
                logger.info('[WhatsApp DB] Added column isFollowUpEnabled to whatsapp_chatbot table')
            } catch (e) {
                // ignore if column already exists
            }
            // Add followUpDelayMinutes
            try {
                await dataSource.query('ALTER TABLE whatsapp_chatbot ADD COLUMN followUpDelayMinutes INTEGER DEFAULT 1440')
                logger.info('[WhatsApp DB] Added column followUpDelayMinutes to whatsapp_chatbot table')
            } catch (e) {
                // ignore if column already exists
            }
            // Add followUpSystemPrompt
            try {
                await dataSource.query('ALTER TABLE whatsapp_chatbot ADD COLUMN followUpSystemPrompt TEXT')
                logger.info('[WhatsApp DB] Added column followUpSystemPrompt to whatsapp_chatbot table')
            } catch (e) {
                // ignore if column already exists
            }
            // Add connectedAt to whatsapp_device
            try {
                await dataSource.query('ALTER TABLE whatsapp_device ADD COLUMN connectedAt BIGINT')
                logger.info('[WhatsApp DB] Added column connectedAt to whatsapp_device table')
            } catch (e) {
                // ignore if column already exists
            }
            // Add business hours columns
            try {
                await dataSource.query('ALTER TABLE whatsapp_chatbot ADD COLUMN businessHoursEnabled BOOLEAN DEFAULT 0')
                logger.info('[WhatsApp DB] Added column businessHoursEnabled')
            } catch (e) {
                /* ignore */
            }
            try {
                await dataSource.query("ALTER TABLE whatsapp_chatbot ADD COLUMN businessHoursStart TEXT DEFAULT '09:00'")
                logger.info('[WhatsApp DB] Added column businessHoursStart')
            } catch (e) {
                /* ignore */
            }
            try {
                await dataSource.query("ALTER TABLE whatsapp_chatbot ADD COLUMN businessHoursEnd TEXT DEFAULT '22:00'")
                logger.info('[WhatsApp DB] Added column businessHoursEnd')
            } catch (e) {
                /* ignore */
            }
            try {
                await dataSource.query('ALTER TABLE whatsapp_chatbot ADD COLUMN outsideHoursMessage TEXT')
                logger.info('[WhatsApp DB] Added column outsideHoursMessage')
            } catch (e) {
                /* ignore */
            }
        } catch (err: any) {
            logger.error('[WhatsApp DB] Error executing column migrations:', err.message)
        }
    }

    public async initializeAllSessions(): Promise<void> {
        try {
            await this.ensureDatabaseColumns()
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
        // Load connectedAt from device DB so filtering persists across server restarts
        if (device.connectedAt) {
            store.connectedAt = Number(device.connectedAt)
        }
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
            syncFullHistory: false, // Anti-ban: avoid bulk history sync that triggers spam detection
            generateHighQualityLinkPreview: true
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
                // Set connectedAt only on first connection (not on reconnects)
                if (!device.connectedAt) {
                    device.connectedAt = Math.floor(Date.now() / 1000)
                    logger.info(`[WhatsApp Device ${device.name}] First connection. connectedAt set to ${device.connectedAt}`)
                }
                // Pass connectedAt to the store for filtering
                store.connectedAt = device.connectedAt
                await deviceRepo.save(device)
                logger.info(`[WhatsApp Device ${device.name}] Connected. Number: ${device.phoneNumber || 'unknown'}`)
                this.initializing.delete(deviceId)
                // Anti-ban: Reset reconnect counter on successful connection
                this.reconnectAttempts.delete(deviceId)
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
                    // Anti-ban: Exponential backoff - 10s, 20s, 40s, 80s... up to 5 min max
                    const attempt = (this.reconnectAttempts.get(deviceId) || 0) + 1
                    this.reconnectAttempts.set(deviceId, attempt)
                    const delay = Math.min(10000 * Math.pow(2, attempt - 1), this.MAX_RECONNECT_DELAY_MS)
                    logger.info(`[WhatsApp Device ${device.name}] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${attempt})`)
                    setTimeout(() => {
                        this.initSession(deviceId).catch((err) => {
                            logger.error(`Failed to reconnect WhatsApp session ${device.name}:`, err.message)
                        })
                    }, delay)
                } else {
                    device.status = 'DISCONNECTED'
                    device.qrCode = undefined
                    device.phoneNumber = undefined
                    // Reset connectedAt on logout so next link starts fresh
                    device.connectedAt = undefined
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

                    // Business Hours: Check if we're within operating hours
                    if (!this.isWithinBusinessHours(activeChatbot)) {
                        // Check if we already sent the away message today for this contact
                        const chatRecord = store.chats.get(remoteJid)
                        const aliasLid = remoteJid.endsWith('@lid') ? remoteJid : store.pnToLid.get(remoteJid)
                        const aliasPn = remoteJid.endsWith('@s.whatsapp.net') ? remoteJid : store.lidToPn.get(remoteJid)
                        const lastSent = Math.max(
                            chatRecord?.lastOutsideHoursMsg || 0,
                            (aliasLid ? store.chats.get(aliasLid)?.lastOutsideHoursMsg : 0) || 0,
                            (aliasPn ? store.chats.get(aliasPn)?.lastOutsideHoursMsg : 0) || 0
                        )

                        // If already sent today → completely ignore (no reply at all)
                        const today = new Date().toDateString()
                        const lastSentDate = lastSent ? new Date(lastSent * 1000).toDateString() : ''
                        if (today === lastSentDate) {
                            logger.debug(`[WhatsApp Business Hours] Already sent away message today to ${senderId}. Ignoring.`)
                            continue
                        }

                        // Rate limit check
                        if (!this.canSendMessage(deviceId)) {
                            logger.warn(`[WhatsApp Anti-Ban] Rate limit reached. Skipping away message to ${senderId}`)
                            continue
                        }

                        // First message outside hours today → send away message once
                        const outsideMsg =
                            activeChatbot.outsideHoursMessage || 'شكراً لتواصلك! نحن حالياً خارج ساعات العمل وسنرد عليك في أقرب وقت ممكن.'
                        logger.info(`[WhatsApp Business Hours] Outside hours for ${device.name}. Sending away message to ${senderId}`)
                        await this.simulateTyping(sock, remoteJid, outsideMsg.length)
                        await sock.sendMessage(remoteJid, { text: outsideMsg })

                        // Record timestamp so we don't send again today
                        const now = Math.floor(Date.now() / 1000)
                        if (chatRecord) {
                            chatRecord.lastOutsideHoursMsg = now
                        } else {
                            store.chats.set(remoteJid, {
                                id: remoteJid,
                                conversationTimestamp: now,
                                unreadCount: 0,
                                lastOutsideHoursMsg: now
                            })
                        }
                        store.save()
                        continue
                    }

                    // Anti-ban: Check rate limit before processing
                    if (!this.canSendMessage(deviceId)) {
                        logger.warn(`[WhatsApp Anti-Ban] Rate limit reached for device ${device.name}. Skipping reply to ${senderId}`)
                        continue
                    }

                    logger.info(`[WhatsApp Chatbot ${activeChatbot.title}] Processing auto-reply for ${senderId}`)

                    // Anti-ban: Add random delay before processing to appear human-like
                    const preDelay = this.randomDelay()
                    logger.debug(`[WhatsApp Anti-Ban] Waiting ${preDelay}ms before processing reply for ${senderId}`)
                    await new Promise((resolve) => setTimeout(resolve, preDelay))

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

                    // Anti-ban: Show typing indicator before sending the reply
                    await this.simulateTyping(sock, remoteJid, replyText.length)

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
            // Reset connectedAt so next connection starts with a fresh timestamp
            device.connectedAt = undefined
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

    private startFollowUpChecker() {
        if (this.followUpTimer) return
        this.followUpTimer = setInterval(() => {
            this.runFollowUpCheck().catch((err) => {
                logger.error('[WhatsApp Follow-Up] Error in background checker loop:', err)
            })
        }, 60000) // check every 60 seconds
    }

    private async runFollowUpCheck() {
        const dataSource = getDataSource()
        const chatbotRepo = dataSource.getRepository(WhatsAppChatbot)
        const activeChatbots = await chatbotRepo.findBy({ isActive: true })

        for (const chatbot of activeChatbots) {
            if (!chatbot.isFollowUpEnabled) continue

            const store = this.getStore(chatbot.deviceId)
            const sock = this.getClient(chatbot.deviceId)
            if (!store || !sock) continue

            const delayMinutes = chatbot.followUpDelayMinutes || 1440
            const systemPrompt = chatbot.followUpSystemPrompt || ''

            for (const [chatId, chatRecord] of store.chats.entries()) {
                if (chatRecord.isPaused) continue

                const messages = store.listMessages(chatId)
                if (messages.length === 0) continue

                const lastMsg = messages[messages.length - 1]
                if (!lastMsg.fromMe) continue

                // Check if we already evaluated or sent a follow-up for this exact message JID state
                if (chatRecord.lastFollowUpSentForMsgId === lastMsg.id || chatRecord.lastFollowUpTriggerId === lastMsg.id) {
                    continue
                }

                // Check when the customer last spoke
                let lastCustomerMsg = null
                for (let i = messages.length - 1; i >= 0; i--) {
                    if (!messages[i].fromMe) {
                        lastCustomerMsg = messages[i]
                        break
                    }
                }
                const T_customer = lastCustomerMsg ? lastCustomerMsg.timestamp : 0
                const lastFollowUpTimestamp = chatRecord.lastFollowUpTimestamp || 0

                if (lastFollowUpTimestamp > T_customer) {
                    // We already followed up since the customer last spoke. Skip to avoid duplicate spam!
                    continue
                }

                const elapsedSeconds = Math.floor(Date.now() / 1000) - lastMsg.timestamp
                const elapsedMinutes = elapsedSeconds / 60

                if (elapsedMinutes >= delayMinutes) {
                    logger.info(
                        `[WhatsApp Follow-Up] Evaluating chat ${chatId} for chatbot ${chatbot.title} (inactivity: ${Math.floor(
                            elapsedMinutes
                        )} mins)`
                    )

                    try {
                        const result = await this.evaluateFollowUp(chatbot, messages, systemPrompt, chatId)
                        if (result && result.decision === 'YES') {
                            logger.info(`[WhatsApp Follow-Up] Decision YES for ${chatId}. Sending follow-up: "${result.message}"`)
                            const sent = await sock.sendMessage(chatId, { text: result.message })
                            if (sent) {
                                chatRecord.lastFollowUpTriggerId = lastMsg.id
                                chatRecord.lastFollowUpSentForMsgId = sent.key.id || undefined
                                chatRecord.lastFollowUpTimestamp = Math.floor(Date.now() / 1000)
                                store.save()
                            }
                        } else {
                            logger.info(`[WhatsApp Follow-Up] Decision NO for ${chatId}`)
                            chatRecord.lastFollowUpTriggerId = lastMsg.id
                            chatRecord.lastFollowUpSentForMsgId = lastMsg.id
                            chatRecord.lastFollowUpTimestamp = Math.floor(Date.now() / 1000)
                            store.save()
                        }
                    } catch (err: any) {
                        logger.error(`[WhatsApp Follow-Up] Evaluation failed for chat ${chatId}:`, err.message)
                    }
                }
            }
        }
    }

    private async evaluateFollowUp(chatbot: WhatsAppChatbot, messages: any[], systemPrompt: string, chatId: string) {
        const historyText = messages
            .slice(-10)
            .map((msg) => `${msg.fromMe ? 'البوت' : 'العميل'}: ${msg.body}`)
            .join('\n')

        const defaultPrompt = `Based on the following chat history between the customer and our chatbot, decide whether we should send a friendly follow-up message.

Chat History:
{chat_history}

Decision Rules:
1. If the conversation ended with a clear agreement, explicit refusal, booking confirmation, or if it doesn't require any response, output 'Decision: NO'.
2. If the customer showed interest but hasn't replied to our last question/message for a while, output 'Decision: YES'.

If the decision is YES, write a friendly and appropriate follow-up message in the same language and tone as the conversation context.
If the decision is NO, leave the message empty.

Examples:

Example 1 (Customer showed interest but hasn't replied to our booking question):
Chat History:
البوت: أهلاً بك! لدينا شقة 3 غرف بسعر 5000 ريال شهرياً. هل تود حجز موعد للمعاينة؟
القرار: نعم
الرسالة: أهلاً بك يا غالي، هل ما زلت مهتماً بمعاينة الشقة في حي النرجس؟

Example 2 (Customer explicitly refused/declined):
Chat History:
العميل: شكراً لك، لا أرغب في الاستمرار.
البوت: على الرحب والسعة! في خدمتك دائماً.
القرار: لا
الرسالة: 

Required Response Format (strict):
Decision: [YES / NO]
Message: [The follow-up message text, or empty]`

        const promptTemplate = systemPrompt || defaultPrompt
        const question = promptTemplate.replace('{chat_history}', historyText)

        const mockReq = {
            params: { id: chatbot.chatflowId },
            protocol: process.env.FLOWISE_URL && process.env.FLOWISE_URL.startsWith('https') ? 'https' : 'http',
            get: (headerName: string) => {
                if (headerName === 'host') {
                    let host = `localhost:${process.env.PORT || 3000}`
                    if (process.env.FLOWISE_URL) {
                        try {
                            host = new URL(process.env.FLOWISE_URL).host
                        } catch (e) {
                            // ignore
                        }
                    }
                    return host
                }
                return undefined
            },
            body: {
                question: question,
                chatId: `followup_eval_${chatId.split('@')[0]}`,
                streaming: false
            },
            files: [],
            headers: {}
        } as unknown as Request

        const result = await utilBuildChatflow(mockReq, true)
        const responseText = result.text || result.output || (typeof result === 'string' ? result : JSON.stringify(result))

        logger.debug(`[WhatsApp Follow-Up] Raw LLM evaluation response: ${responseText}`)

        const decisionMatch = responseText.match(/(?:القرار|Decision):\s*(نعم|لا|Yes|No)/i)
        const decision = decisionMatch ? decisionMatch[1].trim() : 'لا'

        const messageMatch = responseText.match(/(?:الرسالة|Message):\s*(.*)/is)
        const followUpMessage = messageMatch ? messageMatch[1].trim() : ''

        const isYes = decision === 'نعم' || decision.toLowerCase() === 'yes'

        return {
            decision: isYes ? 'YES' : 'NO',
            message: followUpMessage
        }
    }
}
