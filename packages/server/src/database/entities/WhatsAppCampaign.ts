import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm'

@Entity({ name: 'whatsapp_campaign' })
export class WhatsAppCampaign {
    @PrimaryGeneratedColumn('uuid')
    id: string

    @Column()
    name: string

    @Column({ type: 'text' })
    messageTemplate: string

    @Column({ type: 'text' })
    deviceIds: string // JSON array of device IDs

    @Column({ default: 'PENDING' })
    status: string // PENDING, RUNNING, PAUSED, COMPLETED, FAILED

    @Column({ default: 0 })
    totalRecipients: number

    @Column({ default: 0 })
    sentCount: number

    @Column({ default: 0 })
    failedCount: number

    @Column({ default: 30 })
    baseDelay: number // in seconds

    @Column({ default: 10 })
    jitter: number // in seconds

    @Column({ default: 150 })
    dailyLimit: number // per device daily limit

    @Column({ nullable: true })
    createdBy?: string

    @CreateDateColumn()
    createdDate: Date

    @UpdateDateColumn()
    updatedDate: Date
}
