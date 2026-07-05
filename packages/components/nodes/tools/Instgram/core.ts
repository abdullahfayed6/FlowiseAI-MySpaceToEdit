import { z } from 'zod/v3'
import fetch from 'node-fetch'
import { DynamicStructuredTool, DynamicStructuredToolInput } from '../OpenAPIToolkit/core'
import { TOOL_ARGS_PREFIX, formatToolError } from '../../../src/agents'

export interface RequestParameters {
    actions?: string[]
    accessToken?: string
    instagramBusinessId?: string
    defaultParams?: any
}

const BASE_URL = 'https://graph.facebook.com/v21.0'

// ---------------------------------------------------------------------------
// Base Tool
// ---------------------------------------------------------------------------
class BaseInstagramTool extends DynamicStructuredTool {
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
        // Instagram Graph API requires access_token as query param for all methods
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
            throw new Error(`Instagram Graph API Error ${response.status}: ${errMsg}`)
        }

        return text + TOOL_ARGS_PREFIX + JSON.stringify(params)
    }

    /**
     * Instagram requires containers to reach FINISHED status before publishing.
     * Polls every 3 seconds for up to 90 seconds.
     * status_code values: IN_PROGRESS, FINISHED, ERROR, EXPIRED, PUBLISHED
     */
    protected async waitForContainer(containerId: string, maxAttempts = 30): Promise<void> {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 3000))

            const url = `${BASE_URL}/${containerId}?fields=status_code&access_token=${this.accessToken}`
            const res = await fetch(url)
            const json = (await res.json()) as any
            const status = json?.status_code

            if (status === 'FINISHED') return
            if (status === 'ERROR') throw new Error(`Instagram container processing failed: ${JSON.stringify(json)}`)
            if (status === 'EXPIRED') throw new Error('Instagram container expired before it could be published.')
            // IN_PROGRESS → keep polling
        }
        throw new Error('Instagram container did not finish processing within 90 seconds.')
    }
}

// ---------------------------------------------------------------------------
// SCHEMAS
// ---------------------------------------------------------------------------

// --- Publishing ---
const PublishImagePostSchema = z.object({
    igUserId: z.string().describe('Instagram Business Account ID'),
    imageUrl: z.string().url().describe('Publicly accessible URL of the JPEG image to post'),
    caption: z.string().optional().describe('Caption text including hashtags and @mentions')
})

const PublishVideoReelSchema = z.object({
    igUserId: z.string().describe('Instagram Business Account ID'),
    videoUrl: z.string().url().describe('Publicly accessible URL of the MP4 video/reel'),
    caption: z.string().optional().describe('Caption text including hashtags'),
    mediaType: z.enum(['REELS', 'VIDEO']).default('REELS').describe('Media type: REELS for Instagram Reels, VIDEO for regular video post')
})

const PublishCarouselSchema = z.object({
    igUserId: z.string().describe('Instagram Business Account ID'),
    imageUrls: z.array(z.string().url()).min(2).max(10).describe('Array of 2–10 publicly accessible JPEG image URLs for the carousel'),
    caption: z.string().optional().describe('Caption text for the carousel post')
})

// --- Media ---
const GetMediaSchema = z.object({
    mediaId: z.string().describe('Instagram media object ID (post ID)')
})

const GetUserMediaSchema = z.object({
    igUserId: z.string().describe('Instagram Business Account ID'),
    limit: z.number().optional().default(12).describe('Number of recent posts to return (max 100)')
})

// --- Comments ---
const GetCommentsSchema = z.object({
    mediaId: z.string().describe('Instagram media (post) ID to fetch comments for'),
    limit: z.number().optional().default(25).describe('Number of comments to return')
})

const PostCommentSchema = z.object({
    mediaId: z.string().describe('Instagram media (post) ID to comment on'),
    message: z.string().describe('Text of your comment')
})

const GetRepliesSchema = z.object({
    commentId: z.string().describe('Instagram comment ID to fetch replies for')
})

const ReplyToCommentSchema = z.object({
    commentId: z.string().describe('Instagram comment ID to reply to (must be a top-level comment)'),
    message: z.string().describe('Text of your reply')
})

const HideCommentSchema = z.object({
    commentId: z.string().describe('Instagram comment ID to hide or unhide'),
    hide: z.boolean().default(true).describe('true to hide the comment, false to unhide it')
})

const DeleteCommentSchema = z.object({
    commentId: z.string().describe('Instagram comment ID to delete')
})

// --- Insights ---
const GetMediaInsightsSchema = z.object({
    mediaId: z.string().describe('Instagram media (post) ID to get insights for')
})

const GetAccountInsightsSchema = z.object({
    igUserId: z.string().describe('Instagram Business Account ID'),
    metric: z
        .enum(['impressions', 'reach', 'follower_count', 'profile_views', 'website_clicks', 'accounts_engaged'])
        .default('reach')
        .describe('Metric to retrieve'),
    period: z.enum(['day', 'week', 'days_28', 'month', 'lifetime']).default('day').describe('Time period for the metric')
})

// --- Profile ---
const GetProfileSchema = z.object({
    igUserId: z.string().describe('Instagram Business Account ID to get profile for')
})

// ---------------------------------------------------------------------------
// TOOL CLASSES
// ---------------------------------------------------------------------------

// --- Publish Image Post ---
class PublishImagePostTool extends BaseInstagramTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'instagram_publish_image',
            description: 'Publish a single image post to Instagram. Two-step: create container → publish.',
            schema: PublishImagePostSchema,
            baseUrl: BASE_URL,
            method: 'POST',
            headers: {}
        }
        super({ ...toolInput, accessToken: args.accessToken, defaultParams: args.defaultParams })
    }

    async _call(arg: any): Promise<string> {
        const params = { ...arg, ...this.defaultParams }
        try {
            // Step 1: Create media container
            const containerRes = await this.makeRequest({
                endpoint: `${params.igUserId}/media`,
                method: 'POST',
                body: {
                    image_url: params.imageUrl,
                    caption: params.caption || ''
                },
                params: {}
            })
            const containerId = JSON.parse(containerRes.split(TOOL_ARGS_PREFIX)[0]).id

            // Step 2: Wait for container to finish processing
            await this.waitForContainer(containerId)

            // Step 3: Publish
            return await this.makeRequest({
                endpoint: `${params.igUserId}/media_publish`,
                method: 'POST',
                body: { creation_id: containerId },
                params
            })
        } catch (error: any) {
            return formatToolError(error, params)
        }
    }
}

// --- Publish Video / Reel ---
class PublishVideoReelTool extends BaseInstagramTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'instagram_publish_video',
            description: 'Publish a video or Reel to Instagram. Two-step: create container → publish.',
            schema: PublishVideoReelSchema,
            baseUrl: BASE_URL,
            method: 'POST',
            headers: {}
        }
        super({ ...toolInput, accessToken: args.accessToken, defaultParams: args.defaultParams })
    }

    async _call(arg: any): Promise<string> {
        const params = { ...arg, ...this.defaultParams }
        try {
            // Step 1: Create video container
            const containerRes = await this.makeRequest({
                endpoint: `${params.igUserId}/media`,
                method: 'POST',
                body: {
                    media_type: params.mediaType || 'REELS',
                    video_url: params.videoUrl,
                    caption: params.caption || ''
                },
                params: {}
            })
            const containerId = JSON.parse(containerRes.split(TOOL_ARGS_PREFIX)[0]).id

            // Step 2: Wait for video to finish processing (can take up to 90s)
            await this.waitForContainer(containerId)

            // Step 3: Publish
            return await this.makeRequest({
                endpoint: `${params.igUserId}/media_publish`,
                method: 'POST',
                body: { creation_id: containerId },
                params
            })
        } catch (error: any) {
            return formatToolError(error, params)
        }
    }
}

// --- Publish Carousel ---
class PublishCarouselTool extends BaseInstagramTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'instagram_publish_carousel',
            description: 'Publish a carousel (multi-image) post to Instagram. Provide 2–10 image URLs.',
            schema: PublishCarouselSchema,
            baseUrl: BASE_URL,
            method: 'POST',
            headers: {}
        }
        super({ ...toolInput, accessToken: args.accessToken, defaultParams: args.defaultParams })
    }

    async _call(arg: any): Promise<string> {
        const params = { ...arg, ...this.defaultParams }
        try {
            // Step 1: Create a container for each carousel image
            const childIds: string[] = []
            for (const imageUrl of params.imageUrls) {
                const res = await this.makeRequest({
                    endpoint: `${params.igUserId}/media`,
                    method: 'POST',
                    body: { image_url: imageUrl, is_carousel_item: true },
                    params: {}
                })
                const childId = JSON.parse(res.split(TOOL_ARGS_PREFIX)[0]).id
                // Wait for each child container to finish
                await this.waitForContainer(childId)
                childIds.push(childId)
            }

            // Step 2: Create the carousel container
            const carouselRes = await this.makeRequest({
                endpoint: `${params.igUserId}/media`,
                method: 'POST',
                body: {
                    media_type: 'CAROUSEL',
                    children: childIds.join(','),
                    caption: params.caption || ''
                },
                params: {}
            })
            const carouselId = JSON.parse(carouselRes.split(TOOL_ARGS_PREFIX)[0]).id

            // Step 3: Wait for carousel container, then publish
            await this.waitForContainer(carouselId)

            return await this.makeRequest({
                endpoint: `${params.igUserId}/media_publish`,
                method: 'POST',
                body: { creation_id: carouselId },
                params
            })
        } catch (error: any) {
            return formatToolError(error, params)
        }
    }
}

// --- Get Media ---
class GetMediaTool extends BaseInstagramTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'instagram_get_media',
            description: 'Get details of a specific Instagram post/media by its ID.',
            schema: GetMediaSchema,
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
                endpoint: `${params.mediaId}?fields=id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,like_count,comments_count`,
                method: 'GET',
                params
            })
        } catch (error: any) {
            return formatToolError(error, params)
        }
    }
}

// --- Get User Media Feed ---
class GetUserMediaTool extends BaseInstagramTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'instagram_get_user_media',
            description: "Get recent posts from an Instagram Business Account's media feed.",
            schema: GetUserMediaSchema,
            baseUrl: BASE_URL,
            method: 'GET',
            headers: {}
        }
        super({ ...toolInput, accessToken: args.accessToken, defaultParams: args.defaultParams })
    }

    async _call(arg: any): Promise<string> {
        const params = { ...arg, ...this.defaultParams }
        try {
            const limit = params.limit ?? 12
            return await this.makeRequest({
                endpoint: `${params.igUserId}/media?fields=id,caption,media_type,permalink,timestamp,like_count,comments_count&limit=${limit}`,
                method: 'GET',
                params
            })
        } catch (error: any) {
            return formatToolError(error, params)
        }
    }
}

// --- Get Profile ---
class GetProfileTool extends BaseInstagramTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'instagram_get_profile',
            description: 'Get Instagram Business Account profile information including username, followers and bio.',
            schema: GetProfileSchema,
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
                endpoint: `${params.igUserId}?fields=id,name,username,biography,followers_count,follows_count,media_count,profile_picture_url,website`,
                method: 'GET',
                params
            })
        } catch (error: any) {
            return formatToolError(error, params)
        }
    }
}

// --- Get Comments ---
class GetCommentsTool extends BaseInstagramTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'instagram_get_comments',
            description: 'Get top-level comments on an Instagram post.',
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
                endpoint: `${params.mediaId}/comments?fields=id,text,username,timestamp&limit=${limit}`,
                method: 'GET',
                params
            })
        } catch (error: any) {
            return formatToolError(error, params)
        }
    }
}

// --- Post Comment ---
class PostCommentTool extends BaseInstagramTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'instagram_post_comment',
            description: 'Post a new top-level comment on an Instagram media object.',
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
                endpoint: `${params.mediaId}/comments`,
                method: 'POST',
                body: { message: params.message },
                params
            })
        } catch (error: any) {
            return formatToolError(error, params)
        }
    }
}

// --- Get Replies ---
class GetRepliesTool extends BaseInstagramTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'instagram_get_replies',
            description: 'Get replies to a specific Instagram comment.',
            schema: GetRepliesSchema,
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
                endpoint: `${params.commentId}/replies?fields=id,text,username,timestamp`,
                method: 'GET',
                params
            })
        } catch (error: any) {
            return formatToolError(error, params)
        }
    }
}

// --- Reply to Comment ---
class ReplyToCommentTool extends BaseInstagramTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'instagram_reply_to_comment',
            description: 'Reply to a top-level Instagram comment. Note: replies to replies are placed on the parent comment.',
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
            return await this.makeRequest({
                endpoint: `${params.commentId}/replies`,
                method: 'POST',
                body: { message: params.message },
                params
            })
        } catch (error: any) {
            return formatToolError(error, params)
        }
    }
}

// --- Hide Comment ---
class HideCommentTool extends BaseInstagramTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'instagram_hide_comment',
            description: 'Hide or unhide a comment on an Instagram post.',
            schema: HideCommentSchema,
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
                endpoint: `${params.commentId}`,
                method: 'POST',
                body: { hide: params.hide },
                params
            })
        } catch (error: any) {
            return formatToolError(error, params)
        }
    }
}

// --- Delete Comment ---
class DeleteCommentTool extends BaseInstagramTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'instagram_delete_comment',
            description: 'Delete a comment on an Instagram post.',
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

// --- Get Media Insights ---
class GetMediaInsightsTool extends BaseInstagramTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'instagram_get_media_insights',
            description: 'Get performance insights for an Instagram post: views, likes, reach, saves, shares.',
            schema: GetMediaInsightsSchema,
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
                endpoint: `${params.mediaId}/insights?metric=views,likes,comments,shares,saved,reach`,
                method: 'GET',
                params
            })
        } catch (error: any) {
            return formatToolError(error, params)
        }
    }
}

// --- Get Account Insights ---
class GetAccountInsightsTool extends BaseInstagramTool {
    constructor(args: any) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'instagram_get_account_insights',
            description: 'Get account-level insights for an Instagram Business Account: reach, impressions, follower count, profile views.',
            schema: GetAccountInsightsSchema,
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
                endpoint: `${params.igUserId}/insights?metric=${params.metric}&period=${params.period}`,
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
export const createInstagramTools = (args?: RequestParameters): DynamicStructuredTool[] => {
    const { actions = [], accessToken, defaultParams } = args || {}
    const tools: DynamicStructuredTool[] = []

    if (actions.includes('publishImagePost') || actions.length === 0) tools.push(new PublishImagePostTool({ accessToken, defaultParams }))
    if (actions.includes('publishVideoReel') || actions.length === 0) tools.push(new PublishVideoReelTool({ accessToken, defaultParams }))
    if (actions.includes('publishCarousel') || actions.length === 0) tools.push(new PublishCarouselTool({ accessToken, defaultParams }))
    if (actions.includes('getMedia') || actions.length === 0) tools.push(new GetMediaTool({ accessToken, defaultParams }))
    if (actions.includes('getUserMedia') || actions.length === 0) tools.push(new GetUserMediaTool({ accessToken, defaultParams }))
    if (actions.includes('getProfile') || actions.length === 0) tools.push(new GetProfileTool({ accessToken, defaultParams }))
    if (actions.includes('getComments') || actions.length === 0) tools.push(new GetCommentsTool({ accessToken, defaultParams }))
    if (actions.includes('postComment') || actions.length === 0) tools.push(new PostCommentTool({ accessToken, defaultParams }))
    if (actions.includes('getReplies') || actions.length === 0) tools.push(new GetRepliesTool({ accessToken, defaultParams }))
    if (actions.includes('replyToComment') || actions.length === 0) tools.push(new ReplyToCommentTool({ accessToken, defaultParams }))
    if (actions.includes('hideComment') || actions.length === 0) tools.push(new HideCommentTool({ accessToken, defaultParams }))
    if (actions.includes('deleteComment') || actions.length === 0) tools.push(new DeleteCommentTool({ accessToken, defaultParams }))
    if (actions.includes('getMediaInsights') || actions.length === 0) tools.push(new GetMediaInsightsTool({ accessToken, defaultParams }))
    if (actions.includes('getAccountInsights') || actions.length === 0)
        tools.push(new GetAccountInsightsTool({ accessToken, defaultParams }))

    return tools
}
