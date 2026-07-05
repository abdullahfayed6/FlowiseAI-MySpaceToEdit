import { z } from 'zod/v3'
import fetch from 'node-fetch'
import { DynamicStructuredTool, DynamicStructuredToolInput } from '../OpenAPIToolkit/core'
import { TOOL_ARGS_PREFIX, formatToolError } from '../../../src/agents'

export interface RequestParameters {
    actions?: string[]
    accessToken?: string
    defaultParams?: any
}

const BASE_URL = 'https://graph.facebook.com/v21.0'

// ---------------------------------------------------------------------------
// Base Tool
// ---------------------------------------------------------------------------
class BaseInstagramMessengerTool extends DynamicStructuredTool {
    protected accessToken: string = ''
    protected defaultParams: any = {}

    constructor(args: any) {
        super(args)
        this.accessToken = args.accessToken ?? ''
        this.defaultParams = args.defaultParams || {}
    }

    protected async makeRequest({
        endpoint,
        method = 'GET',
        body,
        params
    }: {
        endpoint: string
        method?: string
        body?: any
        params?: any
    }): Promise<string> {
        // Messenger API for Instagram requires access_token as query param for ALL methods
        const sep = endpoint.includes('?') ? '&' : '?'
        const urlWithToken = `${BASE_URL}/${endpoint}${sep}access_token=${this.accessToken}`

        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        }

        const response = await fetch(urlWithToken, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined
        })

        const text = await response.text()

        if (!response.ok) {
            let errMsg = text
            try {
                const json = JSON.parse(text)
                errMsg = json?.error?.message || text
            } catch {}
            throw new Error(`Instagram Messenger API Error ${response.status}: ${errMsg}`)
        }

        return text + TOOL_ARGS_PREFIX + JSON.stringify(params)
    }
}

// ---------------------------------------------------------------------------
// SCHEMAS
// NOTE: Messenger API for Instagram uses the FACEBOOK PAGE ID in all endpoints,
//       NOT the Instagram Business Account ID.
// ---------------------------------------------------------------------------

// --- Conversations ---
const GetConversationsSchema = z.object({
    pageId: z.string().describe('Facebook Page ID linked to the Instagram account (e.g. 335082433011515 for AI MicroMind)'),
    limit: z.number().optional().default(20).describe('Number of conversations to return (max 100)')
})

const GetConversationByUserSchema = z.object({
    pageId: z.string().describe('Facebook Page ID linked to the Instagram account'),
    userIgsid: z.string().describe('Instagram-Scoped User ID (IGSID) of the customer — found in conversation data')
})

const GetMessagesSchema = z.object({
    conversationId: z.string().describe('Conversation ID to fetch messages for')
})

const GetMessageDetailsSchema = z.object({
    messageId: z.string().describe('Message ID to get full details for (id, message text, from, to, timestamp)')
})

// --- Send Messages ---
const SendTextMessageSchema = z.object({
    pageId: z.string().describe('Facebook Page ID linked to the Instagram account (sender)'),
    recipientIgsid: z.string().describe('Instagram-Scoped User ID (IGSID) of the recipient'),
    text: z.string().max(1000).describe('Message text (max 1000 characters)'),
    useHumanAgentTag: z
        .boolean()
        .optional()
        .default(false)
        .describe('Set to true to use HUMAN_AGENT tag — extends the 24h reply window to 7 days')
})

const SendImageMessageSchema = z.object({
    pageId: z.string().describe('Facebook Page ID linked to the Instagram account (sender)'),
    recipientIgsid: z.string().describe('Instagram-Scoped User ID (IGSID) of the recipient'),
    imageUrl: z.string().url().describe('Publicly accessible image URL to send (max 8MB)')
})

const SendAudioMessageSchema = z.object({
    pageId: z.string().describe('Facebook Page ID linked to the Instagram account (sender)'),
    recipientIgsid: z.string().describe('Instagram-Scoped User ID (IGSID) of the recipient'),
    audioUrl: z.string().url().describe('Publicly accessible audio file URL to send (max 25MB)')
})

const SendVideoMessageSchema = z.object({
    pageId: z.string().describe('Facebook Page ID linked to the Instagram account (sender)'),
    recipientIgsid: z.string().describe('Instagram-Scoped User ID (IGSID) of the recipient'),
    videoUrl: z.string().url().describe('Publicly accessible video file URL to send (max 25MB)')
})

const PrivateReplyToCommentSchema = z.object({
    pageId: z.string().describe('Facebook Page ID linked to the Instagram account (sender)'),
    commentId: z.string().describe('The public Instagram comment ID to reply to privately via DM'),
    text: z.string().max(1000).describe('Text of the private reply message')
})

// ---------------------------------------------------------------------------
// TOOL CLASSES
// ---------------------------------------------------------------------------

// --- Get Conversations ---
class GetConversationsTool extends BaseInstagramMessengerTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'instagram_get_conversations',
            description:
                'Get a list of all Instagram DM conversations from the inbox. Requires Facebook Page ID (NOT Instagram Business Account ID).',
            schema: GetConversationsSchema,
            baseUrl: BASE_URL,
            method: 'GET',
            headers: {}
        }
        super({ ...toolInput, accessToken: args.accessToken, defaultParams: args.defaultParams })
    }

    async _call(arg: any): Promise<string> {
        const params = { ...arg, ...this.defaultParams }
        try {
            const limit = params.limit ?? 20
            return await this.makeRequest({
                endpoint: `${params.pageId}/conversations?platform=instagram&fields=id,participants,updated_time,message_count&limit=${limit}`,
                method: 'GET',
                params
            })
        } catch (error: any) {
            return formatToolError(error, params)
        }
    }
}

// --- Get Conversation by User ---
class GetConversationByUserTool extends BaseInstagramMessengerTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'instagram_get_conversation_by_user',
            description: 'Find the conversation thread with a specific user by their Instagram-Scoped User ID (IGSID).',
            schema: GetConversationByUserSchema,
            baseUrl: BASE_URL,
            method: 'GET',
            headers: {}
        }
        super({ ...toolInput, accessToken: args.accessToken, defaultParams: args.defaultParams })
    }

    async _call(arg: any): Promise<string> {
        const params = { ...arg, ...this.defaultParams }
        try {
            return await this.makeRequest({
                endpoint: `${params.pageId}/conversations?platform=instagram&user_id=${params.userIgsid}&fields=id,participants,updated_time`,
                method: 'GET',
                params
            })
        } catch (error: any) {
            return formatToolError(error, params)
        }
    }
}

// --- Get Messages in Conversation ---
class GetMessagesTool extends BaseInstagramMessengerTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'instagram_get_messages',
            description: 'Get all messages in a specific conversation. Returns message IDs — use Get Message Details for full content.',
            schema: GetMessagesSchema,
            baseUrl: BASE_URL,
            method: 'GET',
            headers: {}
        }
        super({ ...toolInput, accessToken: args.accessToken, defaultParams: args.defaultParams })
    }

    async _call(arg: any): Promise<string> {
        const params = { ...arg, ...this.defaultParams }
        try {
            return await this.makeRequest({
                endpoint: `${params.conversationId}?fields=messages`,
                method: 'GET',
                params
            })
        } catch (error: any) {
            return formatToolError(error, params)
        }
    }
}

// --- Get Message Details ---
class GetMessageDetailsTool extends BaseInstagramMessengerTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'instagram_get_message_details',
            description: 'Get the full details of a specific message: text content, sender, recipient, and timestamp.',
            schema: GetMessageDetailsSchema,
            baseUrl: BASE_URL,
            method: 'GET',
            headers: {}
        }
        super({ ...toolInput, accessToken: args.accessToken, defaultParams: args.defaultParams })
    }

    async _call(arg: any): Promise<string> {
        const params = { ...arg, ...this.defaultParams }
        try {
            return await this.makeRequest({
                endpoint: `${params.messageId}?fields=id,message,from,to,created_time`,
                method: 'GET',
                params
            })
        } catch (error: any) {
            return formatToolError(error, params)
        }
    }
}

// --- Send Text Message ---
class SendTextMessageTool extends BaseInstagramMessengerTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'instagram_send_text_message',
            description:
                'Send a text DM to an Instagram user. The user must have messaged you first. Max 1000 characters. Requires Facebook Page ID.',
            schema: SendTextMessageSchema,
            baseUrl: BASE_URL,
            method: 'POST',
            headers: {}
        }
        super({ ...toolInput, accessToken: args.accessToken, defaultParams: args.defaultParams })
    }

    async _call(arg: any): Promise<string> {
        const params = { ...arg, ...this.defaultParams }
        try {
            const body: any = {
                recipient: { id: params.recipientIgsid },
                message: { text: params.text }
            }
            if (params.useHumanAgentTag) {
                body.messaging_type = 'MESSAGE_TAG'
                body.tag = 'HUMAN_AGENT'
            }
            return await this.makeRequest({
                endpoint: `${params.pageId}/messages`,
                method: 'POST',
                body,
                params
            })
        } catch (error: any) {
            return formatToolError(error, params)
        }
    }
}

// --- Send Image Message ---
class SendImageMessageTool extends BaseInstagramMessengerTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'instagram_send_image_message',
            description: 'Send an image as a DM to an Instagram user via a public URL (max 8MB). Requires Facebook Page ID.',
            schema: SendImageMessageSchema,
            baseUrl: BASE_URL,
            method: 'POST',
            headers: {}
        }
        super({ ...toolInput, accessToken: args.accessToken, defaultParams: args.defaultParams })
    }

    async _call(arg: any): Promise<string> {
        const params = { ...arg, ...this.defaultParams }
        try {
            return await this.makeRequest({
                endpoint: `${params.pageId}/messages`,
                method: 'POST',
                body: {
                    recipient: { id: params.recipientIgsid },
                    message: {
                        attachment: {
                            type: 'image',
                            payload: { url: params.imageUrl, is_reusable: true }
                        }
                    }
                },
                params
            })
        } catch (error: any) {
            return formatToolError(error, params)
        }
    }
}

// --- Send Audio Message ---
class SendAudioMessageTool extends BaseInstagramMessengerTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'instagram_send_audio_message',
            description: 'Send an audio file as a DM to an Instagram user via a public URL (max 25MB). Requires Facebook Page ID.',
            schema: SendAudioMessageSchema,
            baseUrl: BASE_URL,
            method: 'POST',
            headers: {}
        }
        super({ ...toolInput, accessToken: args.accessToken, defaultParams: args.defaultParams })
    }

    async _call(arg: any): Promise<string> {
        const params = { ...arg, ...this.defaultParams }
        try {
            return await this.makeRequest({
                endpoint: `${params.pageId}/messages`,
                method: 'POST',
                body: {
                    recipient: { id: params.recipientIgsid },
                    message: {
                        attachment: {
                            type: 'audio',
                            payload: { url: params.audioUrl, is_reusable: true }
                        }
                    }
                },
                params
            })
        } catch (error: any) {
            return formatToolError(error, params)
        }
    }
}

// --- Send Video Message ---
class SendVideoMessageTool extends BaseInstagramMessengerTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'instagram_send_video_message',
            description: 'Send a video file as a DM to an Instagram user via a public URL (max 25MB). Requires Facebook Page ID.',
            schema: SendVideoMessageSchema,
            baseUrl: BASE_URL,
            method: 'POST',
            headers: {}
        }
        super({ ...toolInput, accessToken: args.accessToken, defaultParams: args.defaultParams })
    }

    async _call(arg: any): Promise<string> {
        const params = { ...arg, ...this.defaultParams }
        try {
            return await this.makeRequest({
                endpoint: `${params.pageId}/messages`,
                method: 'POST',
                body: {
                    recipient: { id: params.recipientIgsid },
                    message: {
                        attachment: {
                            type: 'video',
                            payload: { url: params.videoUrl, is_reusable: true }
                        }
                    }
                },
                params
            })
        } catch (error: any) {
            return formatToolError(error, params)
        }
    }
}

// --- Private Reply to Comment ---
class PrivateReplyToCommentTool extends BaseInstagramMessengerTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'instagram_private_reply_to_comment',
            description: 'Send a private DM reply to a user who left a public comment on your Instagram post. Requires Facebook Page ID.',
            schema: PrivateReplyToCommentSchema,
            baseUrl: BASE_URL,
            method: 'POST',
            headers: {}
        }
        super({ ...toolInput, accessToken: args.accessToken, defaultParams: args.defaultParams })
    }

    async _call(arg: any): Promise<string> {
        const params = { ...arg, ...this.defaultParams }
        try {
            return await this.makeRequest({
                endpoint: `${params.pageId}/messages`,
                method: 'POST',
                body: {
                    recipient: { comment_id: params.commentId },
                    message: { text: params.text }
                },
                params
            })
        } catch (error: any) {
            return formatToolError(error, params)
        }
    }
}

// ---------------------------------------------------------------------------
// FACTORY
// ---------------------------------------------------------------------------
export const createInstagramMessengerTools = (args?: RequestParameters): DynamicStructuredTool[] => {
    const { actions = [], accessToken, defaultParams } = args || {}
    const tools: DynamicStructuredTool[] = []

    if (actions.includes('getConversations') || actions.length === 0) tools.push(new GetConversationsTool({ accessToken, defaultParams }))
    if (actions.includes('getConversationByUser') || actions.length === 0)
        tools.push(new GetConversationByUserTool({ accessToken, defaultParams }))
    if (actions.includes('getMessages') || actions.length === 0) tools.push(new GetMessagesTool({ accessToken, defaultParams }))
    if (actions.includes('getMessageDetails') || actions.length === 0) tools.push(new GetMessageDetailsTool({ accessToken, defaultParams }))
    if (actions.includes('sendTextMessage') || actions.length === 0) tools.push(new SendTextMessageTool({ accessToken, defaultParams }))
    if (actions.includes('sendImageMessage') || actions.length === 0) tools.push(new SendImageMessageTool({ accessToken, defaultParams }))
    if (actions.includes('sendAudioMessage') || actions.length === 0) tools.push(new SendAudioMessageTool({ accessToken, defaultParams }))
    if (actions.includes('sendVideoMessage') || actions.length === 0) tools.push(new SendVideoMessageTool({ accessToken, defaultParams }))
    if (actions.includes('privateReplyToComment') || actions.length === 0)
        tools.push(new PrivateReplyToCommentTool({ accessToken, defaultParams }))

    return tools
}
