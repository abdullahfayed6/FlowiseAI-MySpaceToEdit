import { INodeParams, INodeCredential } from '../src/Interface'

class FacebookPageToken implements INodeCredential {
    label: string
    name: string
    version: number
    inputs: INodeParams[]
    description: string

    constructor() {
        this.label = 'Facebook Page Access Token'
        this.name = 'facebookPageToken'
        this.version = 1.0
        this.description =
            'Provide a Facebook Page Access Token from the <a target="_blank" href="https://developers.facebook.com/tools/explorer">Graph API Explorer</a>. Select your app → choose your Page under "Page Access Tokens" → add pages_manage_posts, pages_read_engagement, pages_manage_engagement, pages_read_user_content → Generate Access Token.'

        this.inputs = [
            {
                label: 'Page Access Token',
                name: 'pageAccessToken',
                type: 'password',
                description: 'Your Facebook Page Access Token from the Graph API Explorer'
            }
        ]
    }
}

module.exports = { credClass: FacebookPageToken }
