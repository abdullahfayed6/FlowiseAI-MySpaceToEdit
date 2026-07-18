import { getDataSource } from '../DataSource'
import { WhatsAppCampaign } from '../database/entities/WhatsAppCampaign'
import { WhatsAppCampaignRecipient } from '../database/entities/WhatsAppCampaignRecipient'
import { WhatsAppDevice } from '../database/entities/WhatsAppDevice'
import { WhatsAppSessionManager } from './WhatsAppSessionManager'
import logger from './logger'
import { MoreThanOrEqual } from 'typeorm'

export class WhatsAppCampaignManager {
    private static instance: WhatsAppCampaignManager
    private isRunning = false
    private campaignDevicePointers: Map<string, number> = new Map()

    private constructor() {
        this.startQueueLoop()
    }

    public static getInstance(): WhatsAppCampaignManager {
        if (!WhatsAppCampaignManager.instance) {
            WhatsAppCampaignManager.instance = new WhatsAppCampaignManager()
        }
        return WhatsAppCampaignManager.instance
    }

    private startQueueLoop() {
        if (this.isRunning) return
        this.isRunning = true
        this.processQueue().catch((err) => {
            logger.error('[WhatsApp Campaign Queue] Fatal error in queue loop:', err)
        })
    }

    private async processQueue() {
        while (this.isRunning) {
            try {
                const dataSource = getDataSource()
                if (!dataSource || !dataSource.isInitialized) {
                    await new Promise((resolve) => setTimeout(resolve, 5000))
                    continue
                }

                const campaignRepo = dataSource.getRepository(WhatsAppCampaign)
                const runningCampaigns = await campaignRepo.find({ where: { status: 'RUNNING' } })

                if (runningCampaigns.length === 0) {
                    await new Promise((resolve) => setTimeout(resolve, 5000))
                    continue
                }

                for (const campaign of runningCampaigns) {
                    await this.processCampaignStep(campaign)
                }
            } catch (err: any) {
                logger.error('[WhatsApp Campaign Queue] Error in queue step:', err.message)
            }

            // Sleep 3 seconds before next iteration
            await new Promise((resolve) => setTimeout(resolve, 3000))
        }
    }

    private parseSpintax(text: string): string {
        const spintaxRegex = /\{([^}]+)\}/g
        let match
        let result = text
        while ((match = spintaxRegex.exec(result)) !== null) {
            const options = match[1].split('|')
            const randomOption = options[Math.floor(Math.random() * options.length)]
            result = result.replace(match[0], randomOption)
            spintaxRegex.lastIndex = 0 // Reset search from start due to replacement
        }
        return result
    }

    private cleanPhoneNumber(phone: string): string {
        let clean = phone.replace(/\D/g, '')
        if (clean.startsWith('00')) {
            clean = clean.substring(2)
        }
        return clean
    }

    private async processCampaignStep(campaign: WhatsAppCampaign) {
        const dataSource = getDataSource()
        const campaignRepo = dataSource.getRepository(WhatsAppCampaign)
        const recipientRepo = dataSource.getRepository(WhatsAppCampaignRecipient)
        const deviceRepo = dataSource.getRepository(WhatsAppDevice)

        // Find one pending recipient for this campaign
        const recipient = await recipientRepo.findOne({
            where: { campaignId: campaign.id, status: 'PENDING' },
            order: { createdDate: 'ASC' }
        })

        if (!recipient) {
            // No more pending recipients -> Mark campaign as completed
            campaign.status = 'COMPLETED'
            await campaignRepo.save(campaign)
            logger.info(`[WhatsApp Campaign] Campaign "${campaign.name}" has completed successfully.`)
            return
        }

        // Parse campaign devices
        let deviceIds: string[] = []
        try {
            deviceIds = JSON.parse(campaign.deviceIds)
        } catch (e) {
            logger.error(`[WhatsApp Campaign] Failed to parse deviceIds for campaign ${campaign.id}`)
            campaign.status = 'FAILED'
            await campaignRepo.save(campaign)
            return
        }

        if (!Array.isArray(deviceIds) || deviceIds.length === 0) {
            logger.error(`[WhatsApp Campaign] No devices specified for campaign ${campaign.id}`)
            campaign.status = 'FAILED'
            await campaignRepo.save(campaign)
            return
        }

        // Find connected and active devices selected for the campaign
        const sessionManager = WhatsAppSessionManager.getInstance()
        const activeDevices: WhatsAppDevice[] = []

        for (const devId of deviceIds) {
            const dev = await deviceRepo.findOneBy({ id: devId })
            if (dev && dev.status === 'CONNECTED' && sessionManager.getClient(devId)) {
                activeDevices.push(dev)
            }
        }

        if (activeDevices.length === 0) {
            logger.warn(`[WhatsApp Campaign] No connected devices found for campaign "${campaign.name}". Pausing campaign.`)
            campaign.status = 'PAUSED'
            await campaignRepo.save(campaign)
            return
        }

        // Select the next device to use (Round-Robin)
        let pointer = this.campaignDevicePointers.get(campaign.id) || 0
        let attempts = 0
        let selectedDevice: WhatsAppDevice | null = null

        const todayStart = new Date()
        todayStart.setHours(0, 0, 0, 0)

        while (attempts < activeDevices.length) {
            const index = (pointer + attempts) % activeDevices.length
            const candidateDevice = activeDevices[index]

            // Check daily limit for this candidate device
            const dailySentCount = await recipientRepo.count({
                where: {
                    sentDeviceId: candidateDevice.id,
                    status: 'SENT',
                    sentDate: MoreThanOrEqual(todayStart)
                }
            })

            if (dailySentCount < campaign.dailyLimit) {
                selectedDevice = candidateDevice
                pointer = (index + 1) % activeDevices.length
                this.campaignDevicePointers.set(campaign.id, pointer)
                break
            } else {
                logger.warn(
                    `[WhatsApp Campaign] Device "${candidateDevice.name}" reached daily limit of ${campaign.dailyLimit}. Skipping in rotation.`
                )
                attempts++
            }
        }

        if (!selectedDevice) {
            logger.warn(
                `[WhatsApp Campaign] All connected devices reached their daily limit for campaign "${campaign.name}". Pausing campaign.`
            )
            campaign.status = 'PAUSED'
            await campaignRepo.save(campaign)
            return
        }

        // Send message to the recipient
        const client = sessionManager.getClient(selectedDevice.id)
        if (!client) {
            // Safety check, should be online
            return
        }

        const rawPhone = this.cleanPhoneNumber(recipient.phoneNumber)
        if (!rawPhone) {
            recipient.status = 'FAILED'
            recipient.errorMessage = 'Invalid phone number format'
            await recipientRepo.save(recipient)
            campaign.failedCount += 1
            await campaignRepo.save(campaign)
            return
        }

        const jid = `${rawPhone}@s.whatsapp.net`

        // Generate personalized text with spintax and name placeholders
        let messageText = campaign.messageTemplate
        messageText = messageText.replace(/\{\{name\}\}/gi, recipient.name || '')
        messageText = this.parseSpintax(messageText)

        try {
            logger.info(`[WhatsApp Campaign Manager] Sending message via device "${selectedDevice.name}" to ${jid}`)

            // Anti-ban typing simulation
            try {
                await client.presenceSubscribe(jid)
                await new Promise((resolve) => setTimeout(resolve, 500))
                await client.sendPresenceUpdate('composing', jid)
                // Wait between 2 and 5 seconds simulating composing
                const typingDuration = Math.min(Math.max(Math.ceil(messageText.length * 40), 2000), 5000)
                await new Promise((resolve) => setTimeout(resolve, typingDuration))
                await client.sendPresenceUpdate('paused', jid)
            } catch (err: any) {
                logger.debug(`[WhatsApp Campaign Anti-Ban] Typing presence failed for ${jid}: ${err.message}`)
            }

            // Send message
            const sent = await client.sendMessage(jid, { text: messageText })
            if (!sent) {
                throw new Error('Message sending returned empty response')
            }

            // Mark recipient as SENT
            recipient.status = 'SENT'
            recipient.sentDeviceId = selectedDevice.id
            recipient.sentDate = new Date()
            recipient.errorMessage = undefined
            await recipientRepo.save(recipient)

            campaign.sentCount += 1
            await campaignRepo.save(campaign)

            logger.info(`[WhatsApp Campaign] Message sent successfully to ${jid} (Device: ${selectedDevice.name})`)
        } catch (error: any) {
            logger.error(`[WhatsApp Campaign] Failed to send message to ${jid} via device "${selectedDevice.name}":`, error.message)

            recipient.status = 'FAILED'
            recipient.errorMessage = error.message || 'Unknown error'
            await recipientRepo.save(recipient)

            campaign.failedCount += 1
            await campaignRepo.save(campaign)
        }

        // Apply campaign delay (baseDelay + random jitter)
        const delaySeconds = campaign.baseDelay + Math.floor(Math.random() * campaign.jitter)
        logger.info(`[WhatsApp Campaign] Sleep for ${delaySeconds} seconds before sending next message...`)
        await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000))
    }
}
