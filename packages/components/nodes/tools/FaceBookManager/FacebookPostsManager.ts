import { convertMultiOptionsToStringArray, getCredentialData, getCredentialParam } from '../../../src/utils'
import { createFacebookTools } from './core'
import type { ICommonObject, INode, INodeData, INodeParams } from '../../../src/Interface'

class FacebookPostsManager_Tools implements INode {
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
        this.label = 'Facebook Manager'
        this.name = 'facebookManager'
        this.version = 1.0
        this.type = 'FacebookManager'
        this.icon = 'facebook.svg'
        this.category = 'Tools'
        this.description = 'Manage Facebook Page posts, comments and replies via the Meta Graph API'
        this.baseClasses = [this.type, 'Tool']

        this.credential = {
            label: 'Connect Credential',
            name: 'credential',
            type: 'credential',
            credentialNames: ['facebookPageToken']
        }

        this.inputs = [
            {
                label: 'Actions',
                name: 'actions',
                type: 'multiOptions',
                options: [
                    { label: 'Publish Post', name: 'publishPost' },
                    { label: 'Get Post', name: 'getPost' },
                    { label: 'Get Feed', name: 'getFeed' },
                    { label: 'Delete Post', name: 'deletePost' },
                    { label: 'Get Comments', name: 'getComments' },
                    { label: 'Post Comment', name: 'postComment' },
                    { label: 'Reply to Comment', name: 'replyToComment' },
                    { label: 'Delete Comment', name: 'deleteComment' },
                    { label: 'Get Reactions', name: 'getReactions' }
                ],
                default: ['publishPost']
            },

            // PAGE ID
            {
                label: 'Page ID',
                name: 'pageId',
                type: 'string',
                description: 'Your Facebook Page ID (required for publishing posts)',
                show: {
                    actions: ['publishPost', 'getFeed']
                },
                additionalParams: true,
                optional: true
            },

            // POST MESSAGE
            {
                label: 'Default Message [Publish Post]',
                name: 'message',
                type: 'string',
                description: 'Default message body for published posts',
                rows: 3,
                show: {
                    actions: ['publishPost']
                },
                additionalParams: true,
                optional: true
            },

            // LINK
            {
                label: 'Default Link [Publish Post]',
                name: 'link',
                type: 'string',
                description: 'Default link to attach to the post',
                show: {
                    actions: ['publishPost']
                },
                additionalParams: true,
                optional: true
            },

            // FEED LIMIT
            {
                label: 'Limit [Get Feed / Get Comments]',
                name: 'limit',
                type: 'number',
                description: 'Maximum number of items to return',
                default: 25,
                show: {
                    actions: ['getFeed', 'getComments']
                },
                additionalParams: true,
                optional: true
            }
        ]
    }

    async init(nodeData: INodeData, _: string, options: ICommonObject): Promise<any> {
        const credentialData = await getCredentialData(nodeData.credential ?? '', options)
        const accessToken = getCredentialParam('pageAccessToken', credentialData, nodeData)

        if (!accessToken) {
            throw new Error('No Page Access Token found. Please paste your Facebook Page Access Token in the credential.')
        }

        const actions = convertMultiOptionsToStringArray(nodeData.inputs?.actions)

        const defaultParams = this.transformNodeInputsToToolArgs(nodeData)

        return createFacebookTools({ accessToken, actions, defaultParams })
    }

    transformNodeInputsToToolArgs(nodeData: INodeData): Record<string, any> {
        const inputs = nodeData.inputs || {}
        const args: Record<string, any> = {}

        if (inputs.pageId) args.pageId = inputs.pageId
        if (inputs.message) args.message = inputs.message
        if (inputs.link) args.link = inputs.link
        if (inputs.limit !== undefined) args.limit = inputs.limit

        return args
    }
}

module.exports = { nodeClass: FacebookPostsManager_Tools }
