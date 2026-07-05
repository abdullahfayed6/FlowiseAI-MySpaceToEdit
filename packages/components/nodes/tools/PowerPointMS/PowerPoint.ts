import { INode, INodeData, INodeParams } from '../../../src/Interface'
import { convertMultiOptionsToStringArray, getCredentialData, getCredentialParam, refreshOAuth2Token } from '../../../src/utils'
import { createPowerPointTools } from './core'

class MicrosoftPowerPoint_Tools implements INode {
    label: string
    name: string
    version: number
    description: string
    type: string
    icon: string
    category: string
    baseClasses: string[]
    inputs: INodeParams[]
    credential: INodeParams

    constructor() {
        this.label = 'Microsoft PowerPoint'
        this.name = 'microsoftPowerPoint'
        this.version = 1.0
        this.type = 'MicrosoftPowerPoint'
        this.icon = 'powerpoint.svg'
        this.category = 'Tools'
        this.description = 'Generate professional PowerPoint presentations and save them to OneDrive'
        this.baseClasses = [this.type, 'Tool']

        this.credential = {
            label: 'Connect Credential',
            name: 'credential',
            type: 'credential',
            credentialNames: ['microsoftPowerPointOAuth2']
        }

        this.inputs = [
            {
                label: 'Actions',
                name: 'actions',
                type: 'multiOptions',
                options: [
                    {
                        label: 'Create Presentation',
                        name: 'createPresentation'
                    }
                ],
                default: ['createPresentation']
            },

            // PARAMETERS
            {
                label: 'Default Title [Create Presentation]',
                name: 'pptTitle',
                type: 'string',
                description: 'Default title for the presentation file',
                show: {
                    actions: ['createPresentation']
                },
                additionalParams: true,
                optional: true
            },
            {
                label: 'Default Slides (CSV) [Create Presentation]',
                name: 'pptSlides',
                type: 'string',
                description: 'Comma separated slide titles',
                show: {
                    actions: ['createPresentation']
                },
                additionalParams: true,
                optional: true
            }
        ]
    }

    async init(nodeData: INodeData, _: string, options: any): Promise<any> {
        let credentialData = await getCredentialData(nodeData.credential ?? '', options)
        credentialData = await refreshOAuth2Token(nodeData.credential ?? '', credentialData, options)
        const accessToken = getCredentialParam('access_token', credentialData, nodeData)

        if (!accessToken) {
            throw new Error('No access token found in credential')
        }

        const actions = convertMultiOptionsToStringArray(nodeData.inputs?.actions)

        const defaultParams = {
            pptTitle: nodeData.inputs?.pptTitle,
            pptSlides: nodeData.inputs?.pptSlides
        }

        return createPowerPointTools({
            accessToken,
            actions,
            defaultParams,
            type: this.type
        })
    }
}

module.exports = { nodeClass: MicrosoftPowerPoint_Tools }
