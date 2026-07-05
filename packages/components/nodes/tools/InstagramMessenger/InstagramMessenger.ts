import { convertMultiOptionsToStringArray, getCredentialData, getCredentialParam } from '../../../src/utils'
import { createInstagramMessengerTools } from './core'
import type { ICommonObject, INode, INodeData, INodeParams } from '../../../src/Interface'

class InstagramMessenger_Tools implements INode {
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
        this.label = 'Instagram Messenger'
        this.name = 'instagramMessenger'
        this.version = 1.0
        this.type = 'InstagramMessenger'
        this.icon = 'instagram.svg'
        this.category = 'Tools'
        this.description =
            'Manage Instagram Direct Messages: read conversations, send text/image/audio/video DMs, and reply privately to comments via the Meta Graph API'
        this.baseClasses = [this.type, 'Tool']

        this.credential = {
            label: 'Connect Credential',
            name: 'credential',
            type: 'credential',
            credentialNames: ['instagramMessengerToken']
        }

        this.inputs = [
            {
                label: 'Actions',
                name: 'actions',
                type: 'multiOptions',
                options: [
                    // Read
                    { label: 'Get Conversations', name: 'getConversations' },
                    { label: 'Get Conversation by User', name: 'getConversationByUser' },
                    { label: 'Get Messages in Conversation', name: 'getMessages' },
                    { label: 'Get Message Details', name: 'getMessageDetails' },
                    // Send
                    { label: 'Send Text Message', name: 'sendTextMessage' },
                    { label: 'Send Image Message', name: 'sendImageMessage' },
                    { label: 'Send Audio Message', name: 'sendAudioMessage' },
                    { label: 'Send Video Message', name: 'sendVideoMessage' },
                    // Special
                    { label: 'Private Reply to Comment', name: 'privateReplyToComment' }
                ],
                default: ['getConversations', 'sendTextMessage']
            },

            // --- Optional Defaults ---
            {
                label: 'Default Message Limit',
                name: 'limit',
                type: 'number',
                description: 'Default number of conversations to return',
                default: 20,
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

        return createInstagramMessengerTools({ accessToken, actions, defaultParams })
    }

    transformNodeInputsToToolArgs(nodeData: INodeData): Record<string, any> {
        const inputs = nodeData.inputs || {}
        const args: Record<string, any> = {}

        if (inputs.limit !== undefined) args.limit = inputs.limit

        return args
    }
}

module.exports = { nodeClass: InstagramMessenger_Tools }
