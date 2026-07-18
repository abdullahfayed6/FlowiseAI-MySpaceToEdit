import { ExpressAdapter } from '@bull-board/express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { Request, Response } from 'express'
import 'global-agent/bootstrap'
import http from 'http'
import path from 'path'
import { DataSource } from 'typeorm'
import { AbortControllerPool } from './AbortControllerPool'
import { CachePool } from './CachePool'
import { ChatFlow } from './database/entities/ChatFlow'
import { getDataSource } from './DataSource'
import { Organization } from './enterprise/database/entities/organization.entity'
import { Workspace } from './enterprise/database/entities/workspace.entity'
import { User, UserStatus } from './enterprise/database/entities/user.entity'
import { OrganizationUser, OrganizationUserStatus } from './enterprise/database/entities/organization-user.entity'
import { WorkspaceUser, WorkspaceUserStatus } from './enterprise/database/entities/workspace-user.entity'
import { Role } from './enterprise/database/entities/role.entity'
import { getHash } from './enterprise/utils/encryption.util'
import { LoggedInUser } from './enterprise/Interface.Enterprise'
import { initializeJwtCookieMiddleware, verifyToken, verifyTokenForBullMQDashboard } from './enterprise/middleware/passport'
import { initAuthSecrets } from './enterprise/utils/authSecrets'
import { IdentityManager } from './IdentityManager'
import { MODE, Platform } from './Interface'
import { IMetricsProvider } from './Interface.Metrics'
import { OpenTelemetry } from './metrics/OpenTelemetry'
import { Prometheus } from './metrics/Prometheus'
import errorHandlerMiddleware from './middlewares/errors'
import { NodesPool } from './NodesPool'
import { QueueManager } from './queue/QueueManager'
import { RedisEventSubscriber } from './queue/RedisEventSubscriber'
import flowiseApiV1Router from './routes'
import { UsageCacheManager } from './UsageCacheManager'
import { getEncryptionKey, getNodeModulesPackagePath, generateId } from './utils'
import { API_KEY_BLACKLIST_URLS, WHITELIST_URLS } from './utils/constants'
import logger, { expressRequestLogger } from './utils/logger'
import { RateLimiterManager } from './utils/rateLimit'
import { SSEStreamer } from './utils/SSEStreamer'
import { Telemetry } from './utils/telemetry'
import { validateAPIKey } from './utils/validateKey'
import { getAllowedIframeOrigins, getCorsOptions, sanitizeMiddleware } from './utils/XSS'
import { WhatsAppSessionManager } from './utils/WhatsAppSessionManager'
import { WhatsAppCampaignManager } from './utils/WhatsAppCampaignManager'

declare global {
    namespace Express {
        interface User extends LoggedInUser {}
        interface Request {
            user?: LoggedInUser
        }
        namespace Multer {
            interface File {
                bucket: string
                key: string
                acl: string
                contentType: string
                contentDisposition: null
                storageClass: string
                serverSideEncryption: null
                metadata: any
                location: string
                etag: string
            }
        }
    }
}

export class App {
    app: express.Application
    nodesPool: NodesPool
    abortControllerPool: AbortControllerPool
    cachePool: CachePool
    telemetry: Telemetry
    rateLimiterManager: RateLimiterManager
    AppDataSource: DataSource = getDataSource()
    sseStreamer: SSEStreamer
    identityManager: IdentityManager
    metricsProvider: IMetricsProvider
    queueManager: QueueManager
    redisSubscriber: RedisEventSubscriber
    usageCacheManager: UsageCacheManager
    sessionStore: any

    constructor() {
        this.app = express()
    }

    async initDatabase() {
        // Initialize database
        try {
            await this.AppDataSource.initialize()
            logger.info('📦 [server]: Data Source initialized successfully')

            // Auto-create WhatsApp tables if missing
            await ensureWhatsAppTables(this.AppDataSource)

            // Run Migrations Scripts
            await this.AppDataSource.runMigrations({ transaction: 'each' })
            logger.info('🔄 [server]: Database migrations completed successfully')

            // Auto-create default admin account if not exists
            await ensureDefaultAdminAccount(this.AppDataSource)

            // Initialize WhatsApp Sessions
            await WhatsAppSessionManager.getInstance().initializeAllSessions()
            logger.info('📱 [server]: WhatsApp sessions initialized successfully')

            // Initialize WhatsApp Campaigns
            WhatsAppCampaignManager.getInstance()
            logger.info('📢 [server]: WhatsApp campaigns manager initialized successfully')

            // Initialize Identity Manager
            this.identityManager = await IdentityManager.getInstance()
            logger.info('🔐 [server]: Identity Manager initialized successfully')

            // Initialize nodes pool
            this.nodesPool = new NodesPool()
            await this.nodesPool.initialize()
            logger.info('🔧 [server]: Nodes pool initialized successfully')

            // Initialize abort controllers pool
            this.abortControllerPool = new AbortControllerPool()
            logger.info('⏹️ [server]: Abort controllers pool initialized successfully')

            // Initialize encryption key
            await getEncryptionKey()
            logger.info('🔑 [server]: Encryption key initialized successfully')

            // Initialize auth secrets (env → AWS Secrets Manager → filesystem)
            await initAuthSecrets()
            logger.info('🔐 [server]: Auth initialized successfully')

            // Initialize Rate Limit
            this.rateLimiterManager = RateLimiterManager.getInstance()
            await this.rateLimiterManager.initializeRateLimiters(await getDataSource().getRepository(ChatFlow).find())
            logger.info('🚦 [server]: Rate limiters initialized successfully')

            // Initialize cache pool
            this.cachePool = new CachePool()
            logger.info('💾 [server]: Cache pool initialized successfully')

            // Initialize usage cache manager
            this.usageCacheManager = await UsageCacheManager.getInstance()
            logger.info('📊 [server]: Usage cache manager initialized successfully')

            // Initialize telemetry
            this.telemetry = new Telemetry()
            logger.info('📈 [server]: Telemetry initialized successfully')

            // Initialize SSE Streamer
            this.sseStreamer = new SSEStreamer()
            logger.info('🌊 [server]: SSE Streamer initialized successfully')

            // Init Queues
            if (process.env.MODE === MODE.QUEUE) {
                this.queueManager = QueueManager.getInstance()
                const serverAdapter = new ExpressAdapter()
                serverAdapter.setBasePath('/admin/queues')
                this.queueManager.setupAllQueues({
                    componentNodes: this.nodesPool.componentNodes,
                    telemetry: this.telemetry,
                    cachePool: this.cachePool,
                    appDataSource: this.AppDataSource,
                    abortControllerPool: this.abortControllerPool,
                    usageCacheManager: this.usageCacheManager,
                    serverAdapter
                })
                logger.info('✅ [Queue]: All queues setup successfully')

                this.redisSubscriber = new RedisEventSubscriber(this.sseStreamer)
                await this.redisSubscriber.connect()
                logger.info('🔗 [server]: Redis event subscriber connected successfully')
            }

            logger.info('🎉 [server]: All initialization steps completed successfully!')
        } catch (error) {
            logger.error('❌ [server]: Error during Data Source initialization:', error)
        }
    }

    async config() {
        // Limit is needed to allow sending/receiving base64 encoded string
        const flowise_file_size_limit = process.env.FLOWISE_FILE_SIZE_LIMIT || '50mb'
        this.app.use(express.json({ limit: flowise_file_size_limit }))
        this.app.use(express.urlencoded({ limit: flowise_file_size_limit, extended: true }))

        // Enhanced trust proxy settings for load balancer
        let trustProxy: string | boolean | number | undefined = process.env.TRUST_PROXY
        if (typeof trustProxy === 'undefined' || trustProxy.trim() === '' || trustProxy === 'true') {
            // Default to trust all proxies
            trustProxy = true
        } else if (trustProxy === 'false') {
            // Disable trust proxy
            trustProxy = false
        } else if (!isNaN(Number(trustProxy))) {
            // Number: Trust specific number of proxies
            trustProxy = Number(trustProxy)
        }

        this.app.set('trust proxy', trustProxy)

        // Allow access from specified domains
        this.app.use(cors(getCorsOptions()))

        // Parse cookies
        this.app.use(cookieParser())

        // Allow embedding from specified domains.
        this.app.use((req, res, next) => {
            const allowedOrigins = getAllowedIframeOrigins()
            if (allowedOrigins == '*') {
                next()
            } else {
                const csp = `frame-ancestors ${allowedOrigins}`
                res.setHeader('Content-Security-Policy', csp)
                next()
            }
        })

        // Switch off the default 'X-Powered-By: Express' header
        this.app.disable('x-powered-by')

        // Add the expressRequestLogger middleware to log all requests
        this.app.use(expressRequestLogger)

        // Add the sanitizeMiddleware to guard against XSS
        this.app.use(sanitizeMiddleware)

        const denylistURLs = process.env.DENYLIST_URLS ? process.env.DENYLIST_URLS.split(',') : []
        const whitelistURLs = WHITELIST_URLS.filter((url) => !denylistURLs.includes(url))
        const URL_CASE_INSENSITIVE_REGEX: RegExp = /\/api\/v1\//i
        const URL_CASE_SENSITIVE_REGEX: RegExp = /\/api\/v1\//

        await initializeJwtCookieMiddleware(this.app, this.identityManager)

        this.app.use(async (req, res, next) => {
            // Step 1: Check if the req path contains /api/v1 regardless of case
            if (URL_CASE_INSENSITIVE_REGEX.test(req.path)) {
                // Step 2: Check if the req path is casesensitive
                if (URL_CASE_SENSITIVE_REGEX.test(req.path)) {
                    // Step 3: Check if the req path is in the whitelist
                    const isWhitelisted = whitelistURLs.some((url) => req.path.startsWith(url))
                    if (isWhitelisted) {
                        next()
                    } else if (req.headers['x-request-from'] === 'internal') {
                        verifyToken(req, res, next)
                    } else {
                        const isAPIKeyBlacklistedURLS = API_KEY_BLACKLIST_URLS.some((url) => req.path.startsWith(url))
                        if (isAPIKeyBlacklistedURLS) {
                            return res.status(401).json({ error: 'Unauthorized Access' })
                        }

                        // Only check license validity for non-open-source platforms
                        if (this.identityManager.getPlatformType() !== Platform.OPEN_SOURCE) {
                            if (!this.identityManager.isLicenseValid()) {
                                return res.status(401).json({ error: 'Unauthorized Access' })
                            }
                        }

                        const { isValid, apiKey } = await validateAPIKey(req)
                        if (!isValid || !apiKey) {
                            return res.status(401).json({ error: 'Unauthorized Access' })
                        }

                        // Find workspace
                        const workspace = await this.AppDataSource.getRepository(Workspace).findOne({
                            where: { id: apiKey.workspaceId }
                        })
                        if (!workspace) {
                            return res.status(401).json({ error: 'Unauthorized Access' })
                        }

                        // Find organization
                        const activeOrganizationId = workspace.organizationId as string
                        const org = await this.AppDataSource.getRepository(Organization).findOne({
                            where: { id: activeOrganizationId }
                        })
                        if (!org) {
                            return res.status(401).json({ error: 'Unauthorized Access' })
                        }
                        const subscriptionId = org.subscriptionId as string
                        const customerId = org.customerId as string
                        const features = await this.identityManager.getFeaturesByPlan(subscriptionId)
                        const productId = await this.identityManager.getProductIdFromSubscription(subscriptionId)
                        // @ts-ignore
                        req.user = {
                            permissions: apiKey.permissions,
                            features,
                            activeOrganizationId: activeOrganizationId,
                            activeOrganizationSubscriptionId: subscriptionId,
                            activeOrganizationCustomerId: customerId,
                            activeOrganizationProductId: productId,
                            isOrganizationAdmin: false,
                            activeWorkspaceId: workspace.id,
                            activeWorkspace: workspace.name
                        }
                        next()
                    }
                } else {
                    return res.status(401).json({ error: 'Unauthorized Access' })
                }
            } else {
                // If the req path does not contain /api/v1, then allow the request to pass through, example: /assets, /canvas
                next()
            }
        })

        // this is for SSO and must be after the JWT cookie middleware
        await this.identityManager.initializeSSO(this.app)

        if (process.env.ENABLE_METRICS === 'true') {
            switch (process.env.METRICS_PROVIDER) {
                // default to prometheus
                case 'prometheus':
                case undefined:
                    this.metricsProvider = new Prometheus(this.app)
                    break
                case 'open_telemetry':
                    this.metricsProvider = new OpenTelemetry(this.app)
                    break
                // add more cases for other metrics providers here
            }
            if (this.metricsProvider) {
                await this.metricsProvider.initializeCounters()
                logger.info(`📊 [server]: Metrics Provider [${this.metricsProvider.getName()}] has been initialized!`)
            } else {
                logger.error(
                    "❌ [server]: Metrics collection is enabled, but failed to initialize provider (valid values are 'prometheus' or 'open_telemetry'."
                )
            }
        }

        this.app.use('/api/v1', flowiseApiV1Router)

        // ----------------------------------------
        // Configure number of proxies in Host Environment
        // ----------------------------------------
        this.app.get('/api/v1/ip', (request, response) => {
            response.send({
                ip: request.ip,
                msg: 'Check returned IP address in the response. If it matches your current IP address ( which you can get by going to http://ip.nfriedly.com/ or https://api.ipify.org/ ), then the number of proxies is correct and the rate limiter should now work correctly. If not, increase the number of proxies by 1 and restart Cloud-Hosted Flowise until the IP address matches your own. Visit https://docs.flowiseai.com/configuration/rate-limit#cloud-hosted-rate-limit-setup-guide for more information.'
            })
        })

        if (process.env.MODE === MODE.QUEUE && process.env.ENABLE_BULLMQ_DASHBOARD === 'true' && !this.identityManager.isCloud()) {
            // Initialize admin queues rate limiter
            const id = 'bullmq_admin_dashboard'
            await this.rateLimiterManager.addRateLimiter(
                id,
                60,
                100,
                process.env.ADMIN_RATE_LIMIT_MESSAGE || 'Too many requests to admin dashboard, please try again later.'
            )

            const rateLimiter = this.rateLimiterManager.getRateLimiterById(id)
            this.app.use('/admin/queues', rateLimiter, verifyTokenForBullMQDashboard, this.queueManager.getBullBoardRouter())
        }

        // ----------------------------------------
        // Serve UI static
        // ----------------------------------------

        const packagePath = getNodeModulesPackagePath('flowise-ui')
        const uiBuildPath = path.join(packagePath, 'build')
        const uiHtmlPath = path.join(packagePath, 'build', 'index.html')

        this.app.use('/', express.static(uiBuildPath))

        // All other requests not handled will return React app
        this.app.use((req: Request, res: Response) => {
            res.sendFile(uiHtmlPath)
        })

        // Error handling
        this.app.use(errorHandlerMiddleware)
    }

    async stopApp() {
        try {
            const removePromises: any[] = []
            removePromises.push(this.telemetry.flush())
            if (this.queueManager) {
                removePromises.push(this.redisSubscriber.disconnect())
            }
            await Promise.all(removePromises)
        } catch (e) {
            logger.error(`❌[server]: Flowise Server shut down error: ${e}`)
        }
    }
}

let serverApp: App | undefined

export async function start(): Promise<void> {
    serverApp = new App()

    const host = process.env.HOST
    const port = parseInt(process.env.PORT || '', 10) || 3000
    const server = http.createServer(serverApp.app)

    await serverApp.initDatabase()
    await serverApp.config()

    server.listen(port, host, () => {
        logger.info(`⚡️ [server]: Flowise Server is listening at ${host ? 'http://' + host : ''}:${port}`)
    })
}

export function getInstance(): App | undefined {
    return serverApp
}

async function ensureWhatsAppTables(dataSource: DataSource) {
    const queryRunner = dataSource.createQueryRunner()
    try {
        const dbType = dataSource.options.type
        const textCol = 'TEXT'
        const dateCol = dbType === 'postgres' ? 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' : 'DATETIME DEFAULT CURRENT_TIMESTAMP'
        const boolCol = dbType === 'postgres' ? 'BOOLEAN DEFAULT TRUE' : 'BOOLEAN DEFAULT 1'
        const bigIntCol = dbType === 'postgres' ? 'BIGINT' : 'INTEGER'

        const hasDeviceTable = await queryRunner.hasTable('whatsapp_device')
        if (!hasDeviceTable) {
            const idCol = dbType === 'postgres' ? 'UUID PRIMARY KEY' : 'VARCHAR(36) PRIMARY KEY'

            await queryRunner.query(`
                CREATE TABLE whatsapp_device (
                    id ${idCol},
                    name VARCHAR(255) NOT NULL,
                    sessionName VARCHAR(255) NOT NULL,
                    phoneNumber VARCHAR(255),
                    status VARCHAR(50) DEFAULT 'DISCONNECTED',
                    qrCode ${textCol},
                    connectedAt ${bigIntCol},
                    createdBy ${textCol},
                    createdDate ${dateCol},
                    updatedDate ${dateCol}
                );
            `)
            logger.info('Created whatsapp_device table')
        } else {
            // Check and add missing columns for existing table
            const ensureDeviceColumn = async (colName: string, colType: string) => {
                const columns = await queryRunner.query(
                    dbType === 'postgres'
                        ? `SELECT column_name FROM information_schema.columns WHERE table_name = 'whatsapp_device' AND column_name = '${colName}';`
                        : `PRAGMA table_info(whatsapp_device);`
                )
                const exists = dbType === 'postgres' ? columns.length > 0 : columns.some((col: any) => col.name === colName)
                if (!exists) {
                    await queryRunner.query(`ALTER TABLE whatsapp_device ADD COLUMN "${colName}" ${colType};`)
                    logger.info(`Added missing column ${colName} to whatsapp_device`)
                }
            }
            await ensureDeviceColumn('connectedAt', bigIntCol)
            await ensureDeviceColumn('createdBy', textCol)
        }

        const hasChatbotTable = await queryRunner.hasTable('whatsapp_chatbot')
        if (!hasChatbotTable) {
            const idCol = dbType === 'postgres' ? 'UUID PRIMARY KEY' : 'VARCHAR(36) PRIMARY KEY'

            await queryRunner.query(`
                CREATE TABLE whatsapp_chatbot (
                    id ${idCol},
                    title VARCHAR(255) NOT NULL,
                    deviceId VARCHAR(36) NOT NULL,
                    chatflowId VARCHAR(36) NOT NULL,
                    isActive ${boolCol},
                    isFollowUpEnabled ${boolCol},
                    followUpDelayMinutes INTEGER DEFAULT 1440,
                    followUpSystemPrompt ${textCol},
                    businessHoursEnabled ${boolCol},
                    businessHoursStart VARCHAR(50) DEFAULT '09:00',
                    businessHoursEnd VARCHAR(50) DEFAULT '22:00',
                    outsideHoursMessage ${textCol},
                    createdDate ${dateCol},
                    updatedDate ${dateCol}
                );
            `)
            logger.info('Created whatsapp_chatbot table')
        } else {
            // Check and add missing columns for existing table
            const ensureChatbotColumn = async (colName: string, colType: string, defaultVal?: string) => {
                const columns = await queryRunner.query(
                    dbType === 'postgres'
                        ? `SELECT column_name FROM information_schema.columns WHERE table_name = 'whatsapp_chatbot' AND column_name = '${colName}';`
                        : `PRAGMA table_info(whatsapp_chatbot);`
                )
                const exists = dbType === 'postgres' ? columns.length > 0 : columns.some((col: any) => col.name === colName)
                if (!exists) {
                    const defaultSql = defaultVal !== undefined ? ` DEFAULT ${defaultVal}` : ''
                    await queryRunner.query(`ALTER TABLE whatsapp_chatbot ADD COLUMN "${colName}" ${colType}${defaultSql};`)
                    logger.info(`Added missing column ${colName} to whatsapp_chatbot`)
                }
            }
            await ensureChatbotColumn('isFollowUpEnabled', boolCol, dbType === 'postgres' ? 'FALSE' : '0')
            await ensureChatbotColumn('followUpDelayMinutes', 'INTEGER', '1440')
            await ensureChatbotColumn('followUpSystemPrompt', textCol)
            await ensureChatbotColumn('businessHoursEnabled', boolCol, dbType === 'postgres' ? 'FALSE' : '0')
            await ensureChatbotColumn('businessHoursStart', 'VARCHAR(50)', "'09:00'")
            await ensureChatbotColumn('businessHoursEnd', 'VARCHAR(50)', "'22:00'")
            await ensureChatbotColumn('outsideHoursMessage', textCol)
        }

        // Create whatsapp_campaign and whatsapp_campaign_recipient tables
        const hasCampaignTable = await queryRunner.hasTable('whatsapp_campaign')
        if (!hasCampaignTable) {
            const idCol = dbType === 'postgres' ? 'UUID PRIMARY KEY' : 'VARCHAR(36) PRIMARY KEY'
            await queryRunner.query(`
                CREATE TABLE whatsapp_campaign (
                    id ${idCol},
                    name VARCHAR(255) NOT NULL,
                    messageTemplate ${textCol} NOT NULL,
                    deviceIds ${textCol} NOT NULL,
                    status VARCHAR(50) DEFAULT 'PENDING',
                    totalRecipients INTEGER DEFAULT 0,
                    sentCount INTEGER DEFAULT 0,
                    failedCount INTEGER DEFAULT 0,
                    baseDelay INTEGER DEFAULT 30,
                    jitter INTEGER DEFAULT 10,
                    dailyLimit INTEGER DEFAULT 150,
                    createdBy ${textCol},
                    createdDate ${dateCol},
                    updatedDate ${dateCol}
                );
            `)
            logger.info('Created whatsapp_campaign table')
        }

        const hasRecipientTable = await queryRunner.hasTable('whatsapp_campaign_recipient')
        if (!hasRecipientTable) {
            const idCol = dbType === 'postgres' ? 'UUID PRIMARY KEY' : 'VARCHAR(36) PRIMARY KEY'
            await queryRunner.query(`
                CREATE TABLE whatsapp_campaign_recipient (
                    id ${idCol},
                    campaignId VARCHAR(36) NOT NULL,
                    phoneNumber VARCHAR(255) NOT NULL,
                    name VARCHAR(255),
                    status VARCHAR(50) DEFAULT 'PENDING',
                    errorMessage ${textCol},
                    sentDeviceId VARCHAR(36),
                    sentDate ${dbType === 'postgres' ? 'TIMESTAMP' : 'DATETIME'},
                    createdDate ${dateCol}
                );
            `)
            logger.info('Created whatsapp_campaign_recipient table')
        }
    } catch (e: any) {
        logger.error('Error ensuring WhatsApp database tables:', e.message)
    } finally {
        await queryRunner.release()
    }
}

async function ensureDefaultAdminAccount(dataSource: DataSource) {
    try {
        const userRepo = dataSource.getRepository(User)
        const adminEmail = 'admin@admin.com'
        const existingAdmin = await userRepo.findOneBy({ email: adminEmail })
        if (existingAdmin) {
            logger.info(`👤 [server]: Default admin account ${adminEmail} already exists`)
            return
        }

        logger.info(`👤 [server]: Creating default admin account ${adminEmail}...`)

        const queryRunner = dataSource.createQueryRunner()
        await queryRunner.connect()
        await queryRunner.startTransaction()

        try {
            // 1. Create User
            const adminId = generateId()
            const user = new User()
            user.id = adminId
            user.email = adminEmail
            user.name = 'Admin'
            user.credential = getHash(adminEmail)
            user.status = UserStatus.ACTIVE
            user.createdBy = adminId
            user.updatedBy = adminId
            const savedUser = await queryRunner.manager.save(User, user)

            // 2. Find OWNER role
            const ownerRole = await queryRunner.manager.findOne(Role, { where: { name: 'owner' } })
            if (!ownerRole) {
                throw new Error('OWNER role not found in database')
            }

            // 3. Create Organization
            const org = new Organization()
            org.name = 'Default Organization'
            org.createdBy = savedUser.id
            org.updatedBy = savedUser.id
            const savedOrg = await queryRunner.manager.save(Organization, org)

            // 4. Create OrganizationUser mapping
            const orgUser = new OrganizationUser()
            orgUser.organizationId = savedOrg.id
            orgUser.userId = savedUser.id
            orgUser.roleId = ownerRole.id
            orgUser.createdBy = savedUser.id
            orgUser.updatedBy = savedUser.id
            orgUser.status = OrganizationUserStatus.ACTIVE
            await queryRunner.manager.save(OrganizationUser, orgUser)

            // 5. Create Workspace
            const workspace = new Workspace()
            workspace.name = 'Default Workspace'
            workspace.organizationId = savedOrg.id
            workspace.createdBy = savedUser.id
            workspace.updatedBy = savedUser.id
            const savedWorkspace = await queryRunner.manager.save(Workspace, workspace)

            // 6. Create WorkspaceUser mapping
            const workspaceUser = new WorkspaceUser()
            workspaceUser.workspaceId = savedWorkspace.id
            workspaceUser.userId = savedUser.id
            workspaceUser.roleId = ownerRole.id
            workspaceUser.createdBy = savedUser.id
            workspaceUser.updatedBy = savedUser.id
            workspaceUser.status = WorkspaceUserStatus.ACTIVE
            await queryRunner.manager.save(WorkspaceUser, workspaceUser)

            await queryRunner.commitTransaction()
            logger.info('👤 [server]: Default admin account created successfully!')
        } catch (error: any) {
            await queryRunner.rollbackTransaction()
            logger.error('❌ [server]: Error during creating default admin transaction:', error)
        } finally {
            await queryRunner.release()
        }
    } catch (err: any) {
        logger.error('❌ [server]: Error ensuring default admin account:', err.message)
    }
}
