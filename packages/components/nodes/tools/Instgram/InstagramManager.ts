import { convertMultiOptionsToStringArray, getCredentialData, getCredentialParam } from '../../../src/utils'
import { createInstagramTools } from './core'
import type { ICommonObject, INode, INodeData, INodeParams } from '../../../src/Interface'

class InstagramManager_Tools implements INode {
    label: string
    name: string
    version: number
    type: string
    icon: string
    category: string
    description: string
    baseClasses: string[]
    credential: INodeParams
    inputs: INodeParams[]

    constructor() {
        this.label = 'Instagram Manager'
        this.name = 'instagramManager'
        this.version = 1.0
        this.type = 'InstagramManager'
        this.icon = 'instagram.svg'
        this.category = 'Tools'
        this.description =
            'Manage Instagram Business Account: publish posts/reels/carousels, manage comments and replies, and retrieve insights via the Meta Graph API'
        this.baseClasses = [this.type, 'Tool']

        this.credential = {
            label: 'Connect Credential',
            name: 'credential',
            type: 'credential',
            credentialNames: ['instagramGraphToken']
        }

        this.inputs = [
            {
                label: 'Actions',
                name: 'actions',
                type: 'multiOptions',
                options: [
                    // Publishing
                    { label: 'Publish Image Post', name: 'publishImagePost' },
                    { label: 'Publish Video / Reel', name: 'publishVideoReel' },
                    { label: 'Publish Carousel (Multi-Image)', name: 'publishCarousel' },
                    // Media
                    { label: 'Get Media (Post Details)', name: 'getMedia' },
                    { label: 'Get User Media Feed', name: 'getUserMedia' },
                    // Profile
                    { label: 'Get Profile', name: 'getProfile' },
                    // Comments
                    { label: 'Get Comments', name: 'getComments' },
                    { label: 'Post Comment', name: 'postComment' },
                    { label: 'Get Replies', name: 'getReplies' },
                    { label: 'Reply to Comment', name: 'replyToComment' },
                    { label: 'Hide / Unhide Comment', name: 'hideComment' },
                    { label: 'Delete Comment', name: 'deleteComment' },
                    // Insights
                    { label: 'Get Media Insights', name: 'getMediaInsights' },
                    { label: 'Get Account Insights', name: 'getAccountInsights' }
                ],
                default: ['publishImagePost']
            },

            // --- Instagram Account ---
            // igUserId is NOT pre-filled here — the agent will ask the user for
            // their Instagram Business Account ID naturally in the conversation.

            // --- Publishing params ---
            {
                label: 'Default Image URL [Publish Image]',
                name: 'imageUrl',
                type: 'string',
                description: 'Default publicly accessible JPEG image URL',
                show: { actions: ['publishImagePost'] },
                additionalParams: true,
                optional: true
            },
            {
                label: 'Default Caption',
                name: 'caption',
                type: 'string',
                rows: 3,
                description: 'Default caption text with hashtags and mentions',
                show: { actions: ['publishImagePost', 'publishVideoReel', 'publishCarousel'] },
                additionalParams: true,
                optional: true
            },
            {
                label: 'Default Video URL [Publish Video/Reel]',
                name: 'videoUrl',
                type: 'string',
                description: 'Default publicly accessible MP4 video URL',
                show: { actions: ['publishVideoReel'] },
                additionalParams: true,
                optional: true
            },

            // --- Feed params ---
            {
                label: 'Limit [Get User Media / Get Comments]',
                name: 'limit',
                type: 'number',
                description: 'Maximum number of items to return',
                default: 25,
                show: { actions: ['getUserMedia', 'getComments'] },
                additionalParams: true,
                optional: true
            },

            // --- Insights params ---
            {
                label: 'Metric [Account Insights]',
                name: 'metric',
                type: 'options',
                options: [
                    { label: 'Reach', name: 'reach' },
                    { label: 'Impressions', name: 'impressions' },
                    { label: 'Follower Count', name: 'follower_count' },
                    { label: 'Profile Views', name: 'profile_views' },
                    { label: 'Website Clicks', name: 'website_clicks' },
                    { label: 'Accounts Engaged', name: 'accounts_engaged' }
                ],
                default: 'reach',
                show: { actions: ['getAccountInsights'] },
                additionalParams: true,
                optional: true
            },
            {
                label: 'Period [Account Insights]',
                name: 'period',
                type: 'options',
                options: [
                    { label: 'Day', name: 'day' },
                    { label: 'Week', name: 'week' },
                    { label: 'Last 28 Days', name: 'days_28' },
                    { label: 'Month', name: 'month' },
                    { label: 'Lifetime', name: 'lifetime' }
                ],
                default: 'day',
                show: { actions: ['getAccountInsights'] },
                additionalParams: true,
                optional: true
            }
        ]
    }

    async init(nodeData: INodeData, _: string, options: ICommonObject): Promise<any> {
        const credentialData = await getCredentialData(nodeData.credential ?? '', options)
        const accessToken = getCredentialParam('pageAccessToken', credentialData, nodeData)

        if (!accessToken) {
            throw new Error('No Page Access Token found. Please add your Facebook Page Access Token in the credential.')
        }

        const actions = convertMultiOptionsToStringArray(nodeData.inputs?.actions)
        const defaultParams = this.transformNodeInputsToToolArgs(nodeData)

        return createInstagramTools({ accessToken, actions, defaultParams })
    }

    transformNodeInputsToToolArgs(nodeData: INodeData): Record<string, any> {
        const inputs = nodeData.inputs || {}
        const args: Record<string, any> = {}

        if (inputs.imageUrl) args.imageUrl = inputs.imageUrl
        if (inputs.videoUrl) args.videoUrl = inputs.videoUrl
        if (inputs.caption) args.caption = inputs.caption
        if (inputs.limit !== undefined) args.limit = inputs.limit
        if (inputs.metric) args.metric = inputs.metric
        if (inputs.period) args.period = inputs.period

        return args
    }
}

module.exports = { nodeClass: InstagramManager_Tools }
