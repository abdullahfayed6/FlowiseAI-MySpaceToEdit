import { INodeParams, INodeCredential } from '../src/Interface'

class InstagramMessengerToken implements INodeCredential {
    label: string
    name: string
    version: number
    inputs: INodeParams[]
    description: string

    constructor() {
        this.label = 'Instagram Messenger Token'
        this.name = 'instagramMessengerToken'
        this.version = 1.0
        this.description =
            'Provide a Facebook Page Access Token from the <a target="_blank" href="https://developers.facebook.com/tools/explorer">Graph API Explorer</a>. ' +
            'Your Instagram Business Account must be linked to a Facebook Page. ' +
            'Add these permissions before generating: <b>instagram_manage_messages, instagram_business_basic, pages_manage_metadata, pages_messaging</b>.'

        this.inputs = [
            {
                label: 'Page Access Token',
                name: 'pageAccessToken',
                type: 'password',
                description:
                    'Your Facebook Page Access Token. In Graph API Explorer: select your app → add permissions → switch to Page token → Generate.'
            }
        ]
    }
}

module.exports = { credClass: InstagramMessengerToken }
