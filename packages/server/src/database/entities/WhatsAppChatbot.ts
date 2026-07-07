import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm'

@Entity({ name: 'whatsapp_chatbot' })
export class WhatsAppChatbot {
    @PrimaryGeneratedColumn('uuid')
    id: string

    @Column()
    title: string

    @Column()
    deviceId: string

    @Column()
    chatflowId: string

    @Column({ default: true })
    isActive: boolean

    @Column({ default: false })
    isFollowUpEnabled: boolean

    @Column({ default: 1440 })
    followUpDelayMinutes: number

    @Column({ type: 'text', nullable: true })
    followUpSystemPrompt: string

    @CreateDateColumn()
    createdDate: Date

    @UpdateDateColumn()
    updatedDate: Date
}
