import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm'

@Entity({ name: 'whatsapp_device' })
export class WhatsAppDevice {
    @PrimaryGeneratedColumn('uuid')
    id: string

    @Column()
    name: string

    @Column()
    sessionName: string

    @Column({ nullable: true })
    phoneNumber?: string

    @Column({ default: 'DISCONNECTED' })
    status: string

    @Column({ type: 'text', nullable: true })
    qrCode?: string

    @Column({ type: 'bigint', nullable: true })
    connectedAt?: number

    @CreateDateColumn()
    createdDate: Date

    @UpdateDateColumn()
    updatedDate: Date
}
