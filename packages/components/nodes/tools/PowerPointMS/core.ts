import { z } from 'zod/v3'
import fetch from 'node-fetch'
import PptxGenJS from 'pptxgenjs'
import { CallbackManagerForToolRun } from '@langchain/core/callbacks/manager'
import { DynamicStructuredTool, DynamicStructuredToolInput } from '../OpenAPIToolkit/core'
import { TOOL_ARGS_PREFIX } from '../../../src/agents'

interface PowerPointToolOptions {
    accessToken: string
    actions: string[]
    defaultParams: any
    type: string
}

const BASE_URL = 'https://graph.microsoft.com/v1.0'

// Base PowerPoint Tool class
abstract class BasePowerPointTool extends DynamicStructuredTool {
    accessToken = ''
    protected defaultParams: any

    constructor(args: DynamicStructuredToolInput<any> & { accessToken?: string; defaultParams?: any }) {
        super(args)
        this.accessToken = args.accessToken ?? ''
        this.defaultParams = args.defaultParams || {}
    }

    protected async fetchImageAsBase64(url: string): Promise<string | null> {
        try {
            const res = await fetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0' }
            })

            if (!res.ok) return null

            const buffer = await res.buffer()
            const contentType = res.headers.get('content-type') || 'image/png'

            return `data:${contentType};base64,${buffer.toString('base64')}`
        } catch {
            return null
        }
    }

    protected formatResponse(data: any, params: any): string {
        return JSON.stringify(data) + TOOL_ARGS_PREFIX + JSON.stringify(params)
    }

    // Abstract method that must be implemented by subclasses
    protected abstract _call(arg: any, runManager?: CallbackManagerForToolRun, parentConfig?: any): Promise<string>
}

// POWERPOINT TOOLS

class CreatePresentationTool extends BasePowerPointTool {
    constructor(args: { accessToken?: string; defaultParams?: any }) {
        const toolInput: DynamicStructuredToolInput<any> = {
            name: 'create_powerpoint',
            description: 'Use this when you want to create a PowerPoint presentation with titles, text content, and images.',
            schema: z.object({
                pptTitle: z.string().describe('The main title/filename of the presentation'),
                pptSlides: z.string().describe('Comma-separated list of slide titles'),
                pptContent: z.string().optional().describe('Detailed body text for each slide, separated by pipe (|)'),
                pptImages: z.string().optional().describe('Comma-separated list of image URLs')
            }),
            baseUrl: BASE_URL,
            method: 'PUT',
            headers: {}
        }

        super({ ...toolInput, accessToken: args.accessToken, defaultParams: args.defaultParams })
    }

    protected async _call(arg: any): Promise<string> {
        const params = { ...arg, ...this.defaultParams }

        try {
            const { pptTitle, pptSlides, pptContent, pptImages } = params

            const slidesArr =
                pptSlides
                    ?.split(',')
                    .map((s: string) => s.trim())
                    .filter(Boolean) || []

            const contentArr = pptContent?.split('|').map((c: string) => c.trim()) || []

            const imagesArr = pptImages?.split(',').map((img: string) => img.trim()) || []

            const pres = new PptxGenJS()
            pres.layout = 'LAYOUT_16x9'

            const totalSlides = Math.max(slidesArr.length, contentArr.length, 1)

            for (let i = 0; i < totalSlides; i++) {
                const slide = pres.addSlide()
                const title = slidesArr[i] || `Slide ${i + 1}`
                const body = contentArr[i] || ''
                const imageUrl = imagesArr[i]

                slide.addText(title, {
                    x: 0.5,
                    y: 0.2,
                    w: '90%',
                    h: 0.8,
                    fontSize: 24,
                    bold: true,
                    color: '363636',
                    align: 'center'
                })

                const base64Img = imageUrl ? await this.fetchImageAsBase64(imageUrl) : null

                if (base64Img) {
                    slide.addText(body, {
                        x: 0.5,
                        y: 1.2,
                        w: 4.5,
                        h: 3.5,
                        fontSize: 14,
                        bullet: true,
                        valign: 'top'
                    })

                    slide.addImage({
                        data: base64Img,
                        x: 5.2,
                        y: 1.1,
                        w: 4.3,
                        h: 3.5
                    })
                } else {
                    slide.addText(body, {
                        x: 0.8,
                        y: 1.3,
                        w: 8.5,
                        h: 3.2,
                        fontSize: 18,
                        bullet: true,
                        align: 'center',
                        valign: 'middle'
                    })
                }
            }

            const buffer = (await (pres as any).write({
                outputType: 'nodebuffer'
            })) as unknown as Buffer

            const safeTitle = (pptTitle || 'Presentation')
                .replace(/[^a-zA-Z0-9 ]/g, '')
                .split(' ')
                .join('_')

            const filename = `${safeTitle}.pptx`

            const uploadUrl = `${BASE_URL}/me/drive/root:/${filename}:/content?@microsoft.graph.conflictBehavior=replace`

            const response = await fetch(uploadUrl, {
                method: 'PUT',
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
                },
                body: buffer
            })

            if (!response.ok) {
                const errText = await response.text()
                throw new Error(`Graph API Error: ${response.status} - ${errText}`)
            }

            const data = await response.json()

            return this.formatResponse(
                {
                    success: true,
                    status: 'success',
                    fileName: filename,
                    webUrl: data.webUrl,
                    downloadUrl: data['@microsoft.graph.downloadUrl']
                },
                params
            )
        } catch (error: any) {
            return this.formatResponse(`PowerPoint Generation Error: ${error?.message || error}`, params)
        }
    }
}

export const createPowerPointTools = (args?: PowerPointToolOptions): DynamicStructuredTool[] => {
    const { accessToken, actions = [], defaultParams } = args || {}
    const tools: DynamicStructuredTool[] = []

    if (actions.includes('createPresentation') || actions.length === 0) {
        tools.push(
            new CreatePresentationTool({
                accessToken,
                defaultParams
            })
        )
    }

    return tools
}
