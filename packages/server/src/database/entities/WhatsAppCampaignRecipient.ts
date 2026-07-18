import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm'

@Entity({ name: 'whatsapp_campaign_recipient' })
export class WhatsAppCampaignRecipient {
    @PrimaryGeneratedColumn('uuid')
    id: string

    @Column()
    campaignId: string

    @Column()
    phoneNumber: string

    @Column({ nullable: true })
    name?: string

    @Column({ default: 'PENDING' })
    status: string // PENDING, SENT, FAILED

    @Column({ type: 'text', nullable: true })
    errorMessage?: string

    @Column({ nullable: true })
    sentDeviceId?: string

    @Column({ type: 'datetime', nullable: true })
    sentDate?: Date

    @CreateDateColumn()
    createdDate: Date
}
