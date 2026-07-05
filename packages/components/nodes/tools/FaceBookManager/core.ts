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
// Base Tool - mirrors the GoogleDocs / MicrosoftTeams native pattern exactly
// ---------------------------------------------------------------------------
class BaseFacebookTool extends DynamicStructuredTool {
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
            throw new Error(`Facebook Graph API Error ${response.status}: ${errMsg}`)
        }

        return text + TOOL_ARGS_PREFIX + JSON.stringify(params)
    }
}

// ---------------------------------------------------------------------------
// TOOL SCHEMAS
// ---------------------------------------------------------------------------

const PublishPostSchema = z.object({
    pageId: z.string().describe('The Facebook Page ID to publish to'),
    message: z.string().describe('The text body of the post'),
    link: z.string().optional().describe('Optional URL link to attach to the post')
})

const GetPostSchema = z.object({
    postId: z.string().describe('The full post ID (e.g. pageId_postId) to retrieve')
})

const GetFeedSchema = z.object({
    pageId: z.string().describe('The Facebook Page ID to get the feed for'),
    limit: z.number().optional().default(25).describe('Number of posts to return (max 100)')
})

const DeletePostSchema = z.object({
    postId: z.string().describe('The full post ID to delete')
})

const GetCommentsSchema = z.object({
    postId: z.string().describe('The post ID to fetch comments for'),
    limit: z.number().optional().default(25).describe('Number of comments to return')
})

const PostCommentSchema = z.object({
    postId: z.string().describe('The post ID to comment on'),
    message: z.string().describe('The text of your comment')
})

const ReplyToCommentSchema = z.object({
    commentId: z.string().describe('The comment ID to reply to'),
    message: z.string().describe('The text of your reply'),
    mentionPageId: z
        .string()
        .optional()
        .describe('Optional: Facebook Page ID to @mention in the reply. The mention will be prepended to the message.')
})

const DeleteCommentSchema = z.object({
    commentId: z.string().describe('The comment ID to delete')
})

const GetReactionsSchema = z.object({
    postId: z.string().describe('The Facebook POST ID to get reactions for. NOTE: reactions are only available on posts, not on comments.'),
    limit: z.number().optional().default(25).describe('Number of reactions to return')
})

// ---------------------------------------------------------------------------
// TOOL CLASSES
// ---------------------------------------------------------------------------

class PublishPostTool extends BaseFacebookTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'publish_facebook_post',
            description: 'Publish a text post (with optional link) to a Facebook Page feed using the Graph API.',
            schema: PublishPostSchema,
            baseUrl: BASE_URL,
            method: 'POST',
            headers: {}
        }
        super({ ...toolInput, accessToken: args.accessToken, defaultParams: args.defaultParams })
    }

    async _call(arg: any): Promise<string> {
        const params = { ...arg, ...this.defaultParams }
        try {
            const body: any = { message: params.message }
            if (params.link) body.link = params.link

            return await this.makeRequest({
                endpoint: `${params.pageId}/feed`,
                method: 'POST',
                body,
                params
            })
        } catch (error: any) {
            return formatToolError(error, params)
        }
    }
}

class GetPostTool extends BaseFacebookTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'get_facebook_post',
            description: 'Retrieve a specific Facebook post by its ID including message, story and created_time.',
            schema: GetPostSchema,
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
                endpoint: `${params.postId}?fields=id,message,story,created_time,permalink_url`,
                method: 'GET',
                params
            })
        } catch (error: any) {
            return formatToolError(error, params)
        }
    }
}

class GetFeedTool extends BaseFacebookTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'get_facebook_feed',
            description: 'Get recent posts from a Facebook Page feed.',
            schema: GetFeedSchema,
            baseUrl: BASE_URL,
            method: 'GET',
            headers: {}
        }
        super({ ...toolInput, accessToken: args.accessToken, defaultParams: args.defaultParams })
    }

    async _call(arg: any): Promise<string> {
        const params = { ...arg, ...this.defaultParams }
        try {
            const limit = params.limit ?? 25
            return await this.makeRequest({
                endpoint: `${params.pageId}/feed?fields=id,message,story,created_time,permalink_url&limit=${limit}`,
                method: 'GET',
                params
            })
        } catch (error: any) {
            return formatToolError(error, params)
        }
    }
}

class DeletePostTool extends BaseFacebookTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'delete_facebook_post',
            description: 'Delete a Facebook post by its ID.',
            schema: DeletePostSchema,
            baseUrl: BASE_URL,
            method: 'DELETE',
            headers: {}
        }
        super({ ...toolInput, accessToken: args.accessToken, defaultParams: args.defaultParams })
    }

    async _call(arg: any): Promise<string> {
        const params = { ...arg, ...this.defaultParams }
        try {
            return await this.makeRequest({
                endpoint: `${params.postId}`,
                method: 'DELETE',
                params
            })
        } catch (error: any) {
            return formatToolError(error, params)
        }
    }
}

class GetCommentsTool extends BaseFacebookTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'get_facebook_comments',
            description: 'Get comments on a Facebook post. Returns the commenter name, message and time.',
            schema: GetCommentsSchema,
            baseUrl: BASE_URL,
            method: 'GET',
            headers: {}
        }
        super({ ...toolInput, accessToken: args.accessToken, defaultParams: args.defaultParams })
    }

    async _call(arg: any): Promise<string> {
        const params = { ...arg, ...this.defaultParams }
        try {
            const limit = params.limit ?? 25
            return await this.makeRequest({
                endpoint: `${params.postId}/comments?fields=id,from{name},message,created_time&limit=${limit}`,
                method: 'GET',
                params
            })
        } catch (error: any) {
            return formatToolError(error, params)
        }
    }
}

class PostCommentTool extends BaseFacebookTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'post_facebook_comment',
            description: 'Post a new comment on a Facebook post.',
            schema: PostCommentSchema,
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
                endpoint: `${params.postId}/comments`,
                method: 'POST',
                body: { message: params.message },
                params
            })
        } catch (error: any) {
            return formatToolError(error, params)
        }
    }
}

class ReplyToCommentTool extends BaseFacebookTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'reply_to_facebook_comment',
            description:
                'Reply to an existing Facebook comment using the comment ID. Optionally @mention a Page by providing mentionPageId.',
            schema: ReplyToCommentSchema,
            baseUrl: BASE_URL,
            method: 'POST',
            headers: {}
        }
        super({ ...toolInput, accessToken: args.accessToken, defaultParams: args.defaultParams })
    }

    async _call(arg: any): Promise<string> {
        const params = { ...arg, ...this.defaultParams }
        try {
            // Build message with optional @mention prefix
            let finalMessage = params.message
            if (params.mentionPageId) {
                finalMessage = `@[${params.mentionPageId}] ${params.message}`
            }
            return await this.makeRequest({
                endpoint: `${params.commentId}/comments`,
                method: 'POST',
                body: { message: finalMessage },
                params
            })
        } catch (error: any) {
            return formatToolError(error, params)
        }
    }
}

class DeleteCommentTool extends BaseFacebookTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'delete_facebook_comment',
            description: 'Delete a Facebook comment by its comment ID.',
            schema: DeleteCommentSchema,
            baseUrl: BASE_URL,
            method: 'DELETE',
            headers: {}
        }
        super({ ...toolInput, accessToken: args.accessToken, defaultParams: args.defaultParams })
    }

    async _call(arg: any): Promise<string> {
        const params = { ...arg, ...this.defaultParams }
        try {
            return await this.makeRequest({
                endpoint: `${params.commentId}`,
                method: 'DELETE',
                params
            })
        } catch (error: any) {
            return formatToolError(error, params)
        }
    }
}

class GetReactionsTool extends BaseFacebookTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'get_facebook_reactions',
            description: 'Get the reactions (Like, Love, Haha, Wow, Sad, Angry) on a Facebook post or comment.',
            schema: GetReactionsSchema,
            baseUrl: BASE_URL,
            method: 'GET',
            headers: {}
        }
        super({ ...toolInput, accessToken: args.accessToken, defaultParams: args.defaultParams })
    }

    async _call(arg: any): Promise<string> {
        const params = { ...arg, ...this.defaultParams }
        try {
            const limit = params.limit ?? 25
            return await this.makeRequest({
                endpoint: `${params.postId}/reactions?fields=id,name,type&limit=${limit}`,
                method: 'GET',
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
export const createFacebookTools = (args?: RequestParameters): DynamicStructuredTool[] => {
    const { actions = [], accessToken, defaultParams } = args || {}
    const tools: DynamicStructuredTool[] = []

    if (actions.includes('publishPost') || actions.length === 0) tools.push(new PublishPostTool({ accessToken, defaultParams }))
    if (actions.includes('getPost') || actions.length === 0) tools.push(new GetPostTool({ accessToken, defaultParams }))
    if (actions.includes('getFeed') || actions.length === 0) tools.push(new GetFeedTool({ accessToken, defaultParams }))
    if (actions.includes('deletePost') || actions.length === 0) tools.push(new DeletePostTool({ accessToken, defaultParams }))
    if (actions.includes('getComments') || actions.length === 0) tools.push(new GetCommentsTool({ accessToken, defaultParams }))
    if (actions.includes('postComment') || actions.length === 0) tools.push(new PostCommentTool({ accessToken, defaultParams }))
    if (actions.includes('replyToComment') || actions.length === 0) tools.push(new ReplyToCommentTool({ accessToken, defaultParams }))
    if (actions.includes('deleteComment') || actions.length === 0) tools.push(new DeleteCommentTool({ accessToken, defaultParams }))
    if (actions.includes('getReactions') || actions.length === 0) tools.push(new GetReactionsTool({ accessToken, defaultParams }))

    return tools
}
