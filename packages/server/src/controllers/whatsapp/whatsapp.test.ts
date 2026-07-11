import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals'
import { Request, Response } from 'express'

// Setup Mocks
const mockRepository = {
    find: jest.fn<any, any>(),
    findOneBy: jest.fn<any, any>(),
    save: jest.fn<any, any>(),
    delete: jest.fn<any, any>()
}
const mockDataSource = {
    getRepository: jest.fn(() => mockRepository)
}
jest.mock('../../DataSource', () => ({
    getDataSource: () => mockDataSource
}))

const mockClient = {
    sendMessage: jest.fn<any, any>(() => Promise.resolve({ key: { id: 'msg_123' }, status: 1, messageTimestamp: 1234567 })),
    chatModify: jest.fn<any, any>(() => Promise.resolve()),
    authState: { creds: { me: { id: 'device_jid@s.whatsapp.net' } } },
    updateMediaMessage: jest.fn<any, any>()
}
const mockStore = {
    listChats: jest.fn<any, any>(() => []),
    listMessages: jest.fn<any, any>(() => []),
    getRawMessage: jest.fn<any, any>(),
    deleteChat: jest.fn<any, any>(),
    pauseChat: jest.fn<any, any>(),
    lidToPn: new Map(),
    pnToLid: new Map()
}
const mockSessionManager = {
    getClient: jest.fn(() => mockClient),
    getStore: jest.fn(() => mockStore)
}
jest.mock('../../utils/WhatsAppSessionManager', () => ({
    WhatsAppSessionManager: {
        getInstance: () => mockSessionManager
    }
}))

// Mock child_process and fs safely using requireActual
const mockExec = jest.fn<any, any>((cmd: string, cb: any) => cb(null, { stdout: '', stderr: '' }))
jest.mock('child_process', () => {
    const actual = jest.requireActual('child_process') as any
    return {
        ...actual,
        exec: (cmd: string, cb: any) => mockExec(cmd, cb)
    }
})

const mockExistsSync = jest.fn<any, any>((path: string) => {
    if (path.includes('output_') || path.includes('input_')) return true
    return true
})
const mockWriteFile = jest.fn<any, any>(() => Promise.resolve())
const mockReadFile = jest.fn<any, any>(() => Promise.resolve(Buffer.from('mock_ogg_data')))
const mockUnlink = jest.fn<any, any>(() => Promise.resolve())

jest.mock('fs', () => {
    const actual = jest.requireActual('fs') as any
    return {
        ...actual,
        existsSync: (path: string) => mockExistsSync(path),
        mkdirSync: jest.fn(),
        promises: {
            ...actual.promises,
            writeFile: (path: string, content: any) => mockWriteFile(path, content),
            readFile: (path: string) => mockReadFile(path),
            unlink: (path: string) => mockUnlink(path)
        }
    }
})

jest.mock('../../utils/logger', () => ({
    __esModule: true,
    default: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))

jest.mock('@whiskeysockets/baileys', () => ({
    downloadMediaMessage: jest.fn(() => Promise.resolve(Buffer.from('downloaded_media')))
}))

// Import controller
import whatsappController from './index'

describe('WhatsApp Integration Controller Unit Tests', () => {
    let mockRes: Partial<Response>
    let mockNext: any

    beforeEach(() => {
        jest.clearAllMocks()
        mockStore.lidToPn.clear()
        mockStore.pnToLid.clear()
        mockRes = {
            status: jest.fn().mockReturnThis() as any,
            json: jest.fn().mockReturnThis() as any,
            send: jest.fn().mockReturnThis() as any,
            setHeader: jest.fn().mockReturnThis() as any
        }
        mockNext = jest.fn()
    })

    describe('checkAllowedDevice (Permissions Policy)', () => {
        it('should allow access if user is admin', async () => {
            const req = {
                user: { email: 'admin@admin.com' },
                params: { deviceId: 'dev_123' }
            } as unknown as Request

            mockRepository.find.mockResolvedValue([])

            // Invoke getChats to trigger checkAllowedDevice internally
            await whatsappController.getChats(req, mockRes as Response, mockNext)

            expect(mockRes.status).not.toHaveBeenCalledWith(403)
            expect(mockNext).not.toHaveBeenCalled()
        })

        it('should allow access if device was created by the user', async () => {
            const req = {
                user: { id: 'user_456', email: 'agent@test.com' },
                params: { deviceId: 'dev_123' }
            } as unknown as Request

            mockRepository.findOneBy.mockImplementation((opts: any) => {
                if (opts.id === 'dev_123') return Promise.resolve({ id: 'dev_123', createdBy: 'user_456' })
                return Promise.resolve(null)
            })

            await whatsappController.getChats(req, mockRes as Response, mockNext)

            expect(mockRes.status).not.toHaveBeenCalledWith(403)
            expect(mockNext).not.toHaveBeenCalled()
        })

        it('should allow access if device is in user allowedDevices JSON array', async () => {
            const req = {
                user: { id: 'user_456', email: 'agent@test.com', allowedDevices: '["dev_123", "dev_789"]' },
                params: { deviceId: 'dev_123' }
            } as unknown as Request

            mockRepository.findOneBy.mockResolvedValue(null) // Not creator

            await whatsappController.getChats(req, mockRes as Response, mockNext)

            expect(mockRes.status).not.toHaveBeenCalledWith(403)
            expect(mockNext).not.toHaveBeenCalled()
        })

        it('should return 403 Forbidden if user has no permission for device', async () => {
            const req = {
                user: { id: 'user_456', email: 'agent@test.com', allowedDevices: '["dev_789"]' },
                params: { deviceId: 'dev_123' }
            } as unknown as Request

            mockRepository.findOneBy.mockResolvedValue({ id: 'dev_123', createdBy: 'other_user' })

            await whatsappController.getChats(req, mockRes as Response, mockNext)

            expect(mockRes.status).toHaveBeenCalledWith(403)
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'Access denied' })
        })
    })

    describe('getChatbots (Chatbot Filter)', () => {
        it('should return all chatbots for admin', async () => {
            const req = {
                user: { email: 'admin@admin.com' }
            } as unknown as Request

            const chatbots = [
                { id: 'cb_1', deviceId: 'dev_1' },
                { id: 'cb_2', deviceId: 'dev_2' }
            ]
            mockRepository.find.mockResolvedValue(chatbots)

            await whatsappController.getChatbots(req, mockRes as Response, mockNext)

            expect(mockRes.status).toHaveBeenCalledWith(200)
            expect(mockRes.json).toHaveBeenCalledWith(chatbots)
        })

        it('should filter out chatbots for unauthorized devices for agents', async () => {
            const req = {
                user: { id: 'agent_1', email: 'agent@test.com', allowedDevices: '["dev_1"]' }
            } as unknown as Request

            const chatbots = [
                { id: 'cb_1', deviceId: 'dev_1' },
                { id: 'cb_2', deviceId: 'dev_2' }
            ]
            mockRepository.find.mockResolvedValue(chatbots)
            mockRepository.findOneBy.mockResolvedValue(null) // Not created by them

            await whatsappController.getChatbots(req, mockRes as Response, mockNext)

            expect(mockRes.status).toHaveBeenCalledWith(200)
            // Should only return cb_1
            expect(mockRes.json).toHaveBeenCalledWith([{ id: 'cb_1', deviceId: 'dev_1' }])
        })
    })

    describe('sendMessage (Audio Transcoding)', () => {
        it('should send standard text message without transcoding', async () => {
            const req = {
                user: { email: 'admin@admin.com' },
                params: { deviceId: 'dev_123', chatId: 'contact_123' },
                body: { text: 'Hello!' }
            } as unknown as Request

            await whatsappController.sendMessage(req, mockRes as Response, mockNext)

            expect(mockClient.sendMessage).toHaveBeenCalledWith('contact_123', { text: 'Hello!' })
            expect(mockRes.status).toHaveBeenCalledWith(200)
        })

        it('should transcode audio/webm files to audio/ogg with Opus codec and PTT flag', async () => {
            const req = {
                user: { email: 'admin@admin.com' },
                params: { deviceId: 'dev_123', chatId: 'contact_123' },
                body: {
                    text: '',
                    file: {
                        data: 'data:audio/webm;base64,YWJjZA==',
                        mimeType: 'audio/webm',
                        name: 'voice-message.webm'
                    }
                }
            } as unknown as Request

            await whatsappController.sendMessage(req, mockRes as Response, mockNext)

            // Verify temporary files were written and ffmpeg was called
            expect(mockWriteFile).toHaveBeenCalled()
            expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('ffmpeg'), expect.any(Function))
            expect(mockReadFile).toHaveBeenCalled()
            expect(mockUnlink).toHaveBeenCalledTimes(2)

            // Verify message sent to client contains Opus codec, ptt flag, and converted buffer
            expect(mockClient.sendMessage).toHaveBeenCalledWith('contact_123', {
                audio: Buffer.from('mock_ogg_data'),
                mimetype: 'audio/ogg; codecs=opus',
                ptt: true
            })
            expect(mockRes.status).toHaveBeenCalledWith(200)
        })
    })

    describe('deleteChat (Database and Memory Pruning)', () => {
        it('should delete from client, simple store, and clear ChatMessage SQLite database logs', async () => {
            const req = {
                user: { email: 'admin@admin.com' },
                params: { deviceId: 'dev_123', chatId: '201020465979@s.whatsapp.net' }
            } as unknown as Request

            mockStore.lidToPn.set('201020465979@lid', '201020465979@s.whatsapp.net')
            mockStore.pnToLid.set('201020465979@s.whatsapp.net', '201020465979@lid')

            await whatsappController.deleteChat(req, mockRes as Response, mockNext)

            // Verify Baileys delete instruction sent
            expect(mockClient.chatModify).toHaveBeenCalledWith({ delete: true, lastMessages: [] }, '201020465979@s.whatsapp.net')

            // Verify SimpleStore deleteChat called
            expect(mockStore.deleteChat).toHaveBeenCalledWith('201020465979@s.whatsapp.net')

            // Verify ChatMessage db pruning called for both JID and its alias
            expect(mockRepository.delete).toHaveBeenCalledWith({ chatId: 'whatsapp_201020465979' })
            expect(mockRes.status).toHaveBeenCalledWith(200)
        })
    })

    describe('downloadMessageMedia (Media Downloader)', () => {
        it('should retrieve raw WAMessage and fetch download media buffer', async () => {
            const req = {
                user: { email: 'admin@admin.com' },
                params: { deviceId: 'dev_123', chatId: 'contact_123', messageId: 'msg_987' }
            } as unknown as Request

            const mockRawMessage = {
                key: { id: 'msg_987' },
                message: {
                    audioMessage: {
                        mimetype: 'audio/ogg; codecs=opus'
                    }
                }
            }
            mockStore.getRawMessage.mockReturnValue(mockRawMessage)

            await whatsappController.downloadMessageMedia(req, mockRes as Response, mockNext)

            expect(mockStore.getRawMessage).toHaveBeenCalledWith('contact_123', 'msg_987')
            expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'audio/ogg; codecs=opus')
            expect(mockRes.send).toHaveBeenCalledWith(Buffer.from('downloaded_media'))
        })
    })
})
