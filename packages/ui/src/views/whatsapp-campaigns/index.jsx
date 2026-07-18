import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    Checkbox,
    Grid,
    IconButton,
    LinearProgress,
    Paper,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TextField,
    Typography,
    Alert,
    CircularProgress
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import {
    IconPlus,
    IconTrash,
    IconSend,
    IconPlayerPlay,
    IconPlayerPause,
    IconEye,
    IconFileText,
    IconDeviceMobile
} from '@tabler/icons-react'

// project imports
import ViewHeader from '@/layout/MainLayout/ViewHeader'
import whatsappApi from '@/api/whatsapp'
import useNotifier from '@/utils/useNotifier'

const WhatsAppCampaigns = () => {
    const theme = useTheme()
    const navigate = useNavigate()
    useNotifier()

    const [campaigns, setCampaigns] = useState([])
    const [devices, setDevices] = useState([])
    const [openWizard, setOpenWizard] = useState(false)
    const [wizardStep, setWizardStep] = useState(1)

    // Form fields
    const [campaignName, setCampaignName] = useState('')
    const [messageTemplate, setMessageTemplate] = useState('')
    const [selectedDeviceIds, setSelectedDeviceIds] = useState([])
    const [recipientsRawText, setRecipientsRawText] = useState('')
    const [baseDelay, setBaseDelay] = useState(30)
    const [jitter, setJitter] = useState(10)
    const [dailyLimit, setDailyLimit] = useState(150)

    // New scheduling and validation states
    const [scheduledDate, setScheduledDate] = useState('')
    const [sendingAllowedHoursStart, setSendingAllowedHoursStart] = useState('')
    const [sendingAllowedHoursEnd, setSendingAllowedHoursEnd] = useState('')
    const [isValidatingNumbers, setIsValidatingNumbers] = useState(false)

    const fetchCampaigns = async () => {
        try {
            const res = await whatsappApi.getCampaigns()
            if (res && res.data) {
                setCampaigns(res.data)
            }
        } catch (error) {
            console.error('Error fetching campaigns:', error)
        }
    }

    const fetchDevices = async () => {
        try {
            const res = await whatsappApi.getDevices()
            if (res && res.data) {
                const connected = res.data.filter((d) => d.status === 'CONNECTED')
                setDevices(connected)
            }
        } catch (error) {
            console.error('Error fetching devices:', error)
        }
    }

    useEffect(() => {
        fetchCampaigns()
        fetchDevices()
    }, [])

    const handleOpenWizard = () => {
        setCampaignName('')
        setMessageTemplate('')
        setSelectedDeviceIds([])
        setRecipientsRawText('')
        setBaseDelay(30)
        setJitter(10)
        setDailyLimit(150)
        setScheduledDate('')
        setSendingAllowedHoursStart('')
        setSendingAllowedHoursEnd('')
        setWizardStep(1)
        setOpenWizard(true)
    }

    const handleCloseWizard = () => {
        setOpenWizard(false)
    }

    const handleFileUpload = (e) => {
        const file = e.target.files[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = (evt) => {
            const text = evt.target.result
            setRecipientsRawText(text)
        }
        reader.readAsText(file)
    }

    const handleToggleDevice = (deviceId) => {
        setSelectedDeviceIds((prev) => (prev.includes(deviceId) ? prev.filter((id) => id !== deviceId) : [...prev, deviceId]))
    }

    const parseRecipients = (text) => {
        const lines = text.split('\n')
        const list = []
        for (const line of lines) {
            if (!line.trim()) continue
            const parts = line.split(',')
            const phoneNumber = parts[0].trim()
            const name = parts[1] ? parts[1].trim() : ''
            if (phoneNumber) {
                list.push({ phoneNumber, name })
            }
        }
        return list
    }

    const handleCreateCampaign = async () => {
        const parsedList = parseRecipients(recipientsRawText)
        if (!campaignName || !messageTemplate || selectedDeviceIds.length === 0 || parsedList.length === 0) {
            return
        }

        try {
            await whatsappApi.createCampaign({
                name: campaignName,
                messageTemplate,
                deviceIds: selectedDeviceIds,
                recipients: parsedList,
                baseDelay,
                jitter,
                dailyLimit,
                scheduledDate: scheduledDate || undefined,
                sendingAllowedHoursStart: sendingAllowedHoursStart || undefined,
                sendingAllowedHoursEnd: sendingAllowedHoursEnd || undefined
            })
            setOpenWizard(false)
            fetchCampaigns()
        } catch (error) {
            console.error('Error creating campaign:', error)
            alert(error.response?.data?.error || 'Failed to create campaign')
        }
    }

    const handleValidateRecipients = async () => {
        const parsedList = parseRecipients(recipientsRawText)
        if (parsedList.length === 0) return

        if (selectedDeviceIds.length === 0) {
            alert('Please select at least one sending device in Step 2 before validating numbers.')
            return
        }

        setIsValidatingNumbers(true)
        try {
            const deviceId = selectedDeviceIds[0]
            const rawNumbers = parsedList.map((r) => r.phoneNumber)
            const res = await whatsappApi.filterNumbers(deviceId, rawNumbers)

            if (res && res.data) {
                const { valid, invalid } = res.data
                const validList = parsedList.filter((r) => valid.includes(r.phoneNumber))
                const newRawText = validList.map((r) => `${r.phoneNumber}${r.name ? `,${r.name}` : ''}`).join('\n')

                setRecipientsRawText(newRawText)
                alert(
                    `Validation Complete!\n\n✅ Registered on WhatsApp: ${valid.length} numbers\n❌ Invalid numbers (removed): ${invalid.length} numbers`
                )
            }
        } catch (error) {
            console.error('Error validating numbers:', error)
            alert('Failed to validate numbers. Make sure the selected device is connected.')
        } finally {
            setIsValidatingNumbers(false)
        }
    }

    const handleDeleteCampaign = async (id, name) => {
        if (window.confirm(`Are you sure you want to delete campaign "${name}"?`)) {
            try {
                await whatsappApi.deleteCampaign(id)
                fetchCampaigns()
            } catch (error) {
                console.error('Error deleting campaign:', error)
            }
        }
    }

    const handleStartCampaign = async (e, id) => {
        e.stopPropagation()
        try {
            await whatsappApi.startCampaign(id)
            fetchCampaigns()
        } catch (error) {
            console.error('Error starting campaign:', error)
        }
    }

    const handlePauseCampaign = async (e, id) => {
        e.stopPropagation()
        try {
            await whatsappApi.pauseCampaign(id)
            fetchCampaigns()
        } catch (error) {
            console.error('Error pausing campaign:', error)
        }
    }

    const getStatusColor = (status) => {
        switch (status) {
            case 'COMPLETED':
                return 'success'
            case 'RUNNING':
                return 'primary'
            case 'PAUSED':
                return 'warning'
            case 'FAILED':
                return 'error'
            default:
                return 'secondary'
        }
    }

    const getSpintaxPreview = (text) => {
        const spintaxRegex = /\{([^}]+)\}/g
        let match
        let result = text
        while ((match = spintaxRegex.exec(result)) !== null) {
            const options = match[1].split('|')
            result = result.replace(match[0], options[0])
            spintaxRegex.lastIndex = 0
        }
        return result.replace(/\{\{name\}\}/gi, 'محمد')
    }

    const getProgressValue = (campaign) => {
        if (!campaign.totalRecipients) return 0
        return Math.round(((campaign.sentCount + campaign.failedCount) / campaign.totalRecipients) * 100)
    }

    return (
        <Box sx={{ p: 3 }}>
            <Stack direction='row' alignItems='center' justifyContent='space-between' sx={{ mb: 3 }}>
                <ViewHeader title='WhatsApp Campaigns' description='Create and monitor automated bulk messaging campaigns' />
                <Button variant='contained' color='primary' startIcon={<IconPlus />} onClick={handleOpenWizard} sx={{ borderRadius: 2 }}>
                    Create Campaign
                </Button>
            </Stack>

            <TableContainer component={Paper} sx={{ borderRadius: 3, border: '1px solid', borderColor: theme.palette.grey[900] + 15 }}>
                <Table>
                    <TableHead sx={{ backgroundColor: theme.palette.grey[100] }}>
                        <TableRow>
                            <TableCell sx={{ fontWeight: 'bold' }}>CAMPAIGN NAME</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>DEVICES</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>STATUS</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>PROGRESS</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>CREATED AT</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>ACTIONS</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {campaigns.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} align='center' sx={{ py: 8 }}>
                                    <IconSend size={50} color={theme.palette.grey[400]} />
                                    <Typography variant='body1' color='textSecondary' sx={{ mt: 1 }}>
                                        No bulk campaigns created yet
                                    </Typography>
                                </TableCell>
                            </TableRow>
                        ) : (
                            campaigns.map((camp) => {
                                const progress = getProgressValue(camp)
                                let parsedDevices = []
                                try {
                                    parsedDevices = JSON.parse(camp.deviceIds)
                                } catch (e) {
                                    // ignore
                                }

                                return (
                                    <TableRow
                                        key={camp.id}
                                        hover
                                        style={{ cursor: 'pointer' }}
                                        onClick={() => navigate(`/whatsapp-campaigns/${camp.id}`)}
                                    >
                                        <TableCell sx={{ fontWeight: 500 }}>{camp.name}</TableCell>
                                        <TableCell>
                                            <Chip
                                                avatar={<IconDeviceMobile size={16} style={{ color: theme.palette.primary.main }} />}
                                                label={`${parsedDevices.length} Connected Numbers`}
                                                variant='outlined'
                                                size='small'
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Chip
                                                label={camp.status}
                                                color={getStatusColor(camp.status)}
                                                size='small'
                                                sx={{ fontWeight: 'bold' }}
                                            />
                                        </TableCell>
                                        <TableCell sx={{ width: '25%' }}>
                                            <Stack spacing={1}>
                                                <LinearProgress
                                                    variant='determinate'
                                                    value={progress}
                                                    color={camp.status === 'FAILED' ? 'error' : 'primary'}
                                                    sx={{ height: 6, borderRadius: 3 }}
                                                />
                                                <Stack direction='row' justifyContent='space-between'>
                                                    <Typography variant='caption' color='textSecondary'>
                                                        {progress}% Completed
                                                    </Typography>
                                                    <Typography variant='caption' color='textSecondary'>
                                                        {camp.sentCount + camp.failedCount} / {camp.totalRecipients}
                                                    </Typography>
                                                </Stack>
                                            </Stack>
                                        </TableCell>
                                        <TableCell>{new Date(camp.createdDate).toLocaleDateString()}</TableCell>
                                        <TableCell onClick={(e) => e.stopPropagation()}>
                                            <Stack direction='row' spacing={0.5}>
                                                {camp.status !== 'RUNNING' && camp.status !== 'COMPLETED' && (
                                                    <IconButton
                                                        color='success'
                                                        size='small'
                                                        title='Start / Resume'
                                                        onClick={(e) => handleStartCampaign(e, camp.id)}
                                                    >
                                                        <IconPlayerPlay size={20} />
                                                    </IconButton>
                                                )}
                                                {camp.status === 'RUNNING' && (
                                                    <IconButton
                                                        color='warning'
                                                        size='small'
                                                        title='Pause'
                                                        onClick={(e) => handlePauseCampaign(e, camp.id)}
                                                    >
                                                        <IconPlayerPause size={20} />
                                                    </IconButton>
                                                )}
                                                <IconButton
                                                    color='primary'
                                                    size='small'
                                                    title='View details'
                                                    onClick={() => navigate(`/whatsapp-campaigns/${camp.id}`)}
                                                >
                                                    <IconEye size={20} />
                                                </IconButton>
                                                <IconButton
                                                    color='error'
                                                    size='small'
                                                    title='Delete'
                                                    onClick={() => handleDeleteCampaign(camp.id, camp.name)}
                                                >
                                                    <IconTrash size={20} />
                                                </IconButton>
                                            </Stack>
                                        </TableCell>
                                    </TableRow>
                                )
                            })
                        )}
                    </TableBody>
                </Table>
            </TableContainer>

            {/* Campaign Wizard Dialog */}
            <Dialog open={openWizard} onClose={handleCloseWizard} maxWidth='md' fullWidth>
                <DialogTitle sx={{ pb: 0 }}>
                    <Typography variant='h4'>Create Bulk Campaign</Typography>
                    <Typography variant='caption' color='textSecondary'>
                        Step {wizardStep} of 3:{' '}
                        {wizardStep === 1 ? 'Configure Settings' : wizardStep === 2 ? 'Select Sending Devices' : 'Import Recipients List'}
                    </Typography>
                </DialogTitle>
                <Divider sx={{ my: 1.5 }} />

                <DialogContent sx={{ pt: 1 }}>
                    {wizardStep === 1 && (
                        <Grid container spacing={3}>
                            <Grid item xs={12}>
                                <TextField
                                    fullWidth
                                    label='Campaign Name'
                                    variant='outlined'
                                    placeholder='e.g. Summer Promo, Order Notifications'
                                    value={campaignName}
                                    onChange={(e) => setCampaignName(e.target.value)}
                                />
                            </Grid>
                            <Grid item xs={12} md={8}>
                                <TextField
                                    fullWidth
                                    label='Message Template'
                                    variant='outlined'
                                    multiline
                                    rows={8}
                                    placeholder={`Hi {{name}},\n\nWe have a special {offer|gift} for you! Use {code1|code2} for 20% off.`}
                                    value={messageTemplate}
                                    onChange={(e) => setMessageTemplate(e.target.value)}
                                    helperText='Use {{name}} to personalize. Use {option1|option2} for Spintax randomization to protect against bans.'
                                />
                            </Grid>
                            <Grid item xs={12} md={4}>
                                <Card variant='outlined' sx={{ height: '100%', borderColor: theme.palette.grey[300], borderRadius: 2 }}>
                                    <CardContent>
                                        <Typography variant='h6' sx={{ mb: 1, fontWeight: 'bold' }}>
                                            Message Preview (معاينة النص)
                                        </Typography>
                                        <Typography
                                            variant='body2'
                                            sx={{
                                                whiteSpace: 'pre-wrap',
                                                p: 1.5,
                                                bgcolor: '#fcfcfc',
                                                borderRadius: 1,
                                                minHeight: 120,
                                                border: '1px dashed #ccc'
                                            }}
                                        >
                                            {messageTemplate
                                                ? getSpintaxPreview(messageTemplate)
                                                : 'Compose your message to see a live preview...'}
                                        </Typography>
                                    </CardContent>
                                </Card>
                            </Grid>
                            <Grid item xs={12}>
                                <Typography variant='h5' sx={{ mb: 2, fontWeight: 'bold' }}>
                                    🛡️ Anti-Ban Queue Settings
                                </Typography>
                                <Grid container spacing={2}>
                                    <Grid item xs={4}>
                                        <TextField
                                            fullWidth
                                            type='number'
                                            label='Base Delay (seconds)'
                                            value={baseDelay}
                                            onChange={(e) => setBaseDelay(Number(e.target.value))}
                                            helperText='Minimum wait duration between sends'
                                        />
                                    </Grid>
                                    <Grid item xs={4}>
                                        <TextField
                                            fullWidth
                                            type='number'
                                            label='Random Jitter (seconds)'
                                            value={jitter}
                                            onChange={(e) => setJitter(Number(e.target.value))}
                                            helperText='Adding dynamic randomized sleep offset'
                                        />
                                    </Grid>
                                    <Grid item xs={4}>
                                        <TextField
                                            fullWidth
                                            type='number'
                                            label='Daily Limit (per number)'
                                            value={dailyLimit}
                                            onChange={(e) => setDailyLimit(Number(e.target.value))}
                                            helperText='Maximum daily threshold per device'
                                        />
                                    </Grid>
                                </Grid>
                            </Grid>
                            <Grid item xs={12}>
                                <Typography variant='h5' sx={{ mt: 1, mb: 2, fontWeight: 'bold' }}>
                                    📅 Scheduling & Business Hours (جدولة الإرسال وساعات العمل)
                                </Typography>
                                <Grid container spacing={2}>
                                    <Grid item xs={12} md={4}>
                                        <TextField
                                            fullWidth
                                            type='datetime-local'
                                            label='Scheduled Start Time'
                                            InputLabelProps={{ shrink: true }}
                                            value={scheduledDate}
                                            onChange={(e) => setScheduledDate(e.target.value)}
                                            helperText='Leave blank to start immediately'
                                        />
                                    </Grid>
                                    <Grid item xs={6} md={4}>
                                        <TextField
                                            fullWidth
                                            type='time'
                                            label='Allowed Sending Window (Start)'
                                            InputLabelProps={{ shrink: true }}
                                            value={sendingAllowedHoursStart}
                                            onChange={(e) => setSendingAllowedHoursStart(e.target.value)}
                                            helperText='e.g., 09:00'
                                        />
                                    </Grid>
                                    <Grid item xs={6} md={4}>
                                        <TextField
                                            fullWidth
                                            type='time'
                                            label='Allowed Sending Window (End)'
                                            InputLabelProps={{ shrink: true }}
                                            value={sendingAllowedHoursEnd}
                                            onChange={(e) => setSendingAllowedHoursEnd(e.target.value)}
                                            helperText='e.g., 17:00'
                                        />
                                    </Grid>
                                </Grid>
                            </Grid>
                        </Grid>
                    )}

                    {wizardStep === 2 && (
                        <Box sx={{ py: 1 }}>
                            <Typography variant='h5' sx={{ mb: 2, fontWeight: 'bold' }}>
                                Select WhatsApp Numbers to Balance sending load (اختر أرقام الواتساب المشاركة)
                            </Typography>
                            {devices.length === 0 ? (
                                <Alert severity='warning' sx={{ my: 2 }}>
                                    No active or connected WhatsApp devices found. Please connect your accounts in the WhatsApp Devices
                                    section first.
                                </Alert>
                            ) : (
                                <Grid container spacing={2}>
                                    {devices.map((device) => (
                                        <Grid item xs={12} sm={6} md={4} key={device.id}>
                                            <Paper
                                                variant='outlined'
                                                sx={{
                                                    p: 2,
                                                    borderRadius: 2,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    borderColor: selectedDeviceIds.includes(device.id)
                                                        ? theme.palette.primary.main
                                                        : theme.palette.grey[300],
                                                    bgcolor: selectedDeviceIds.includes(device.id)
                                                        ? theme.palette.primary.light + '20'
                                                        : 'inherit',
                                                    cursor: 'pointer'
                                                }}
                                                onClick={() => handleToggleDevice(device.id)}
                                            >
                                                <Checkbox
                                                    checked={selectedDeviceIds.includes(device.id)}
                                                    onChange={() => handleToggleDevice(device.id)}
                                                    sx={{ mr: 1 }}
                                                />
                                                <Box>
                                                    <Typography variant='h6' sx={{ fontWeight: 'bold' }}>
                                                        {device.name}
                                                    </Typography>
                                                    <Typography variant='caption' color='textSecondary'>
                                                        +{device.phoneNumber}
                                                    </Typography>
                                                </Box>
                                            </Paper>
                                        </Grid>
                                    ))}
                                </Grid>
                            )}
                        </Box>
                    )}

                    {wizardStep === 3 && (
                        <Grid container spacing={3}>
                            <Grid item xs={12}>
                                <Typography variant='h5' sx={{ mb: 1, fontWeight: 'bold' }}>
                                    Import Target Recipients List (قائمة أرقام المستلمين)
                                </Typography>
                                <Typography variant='caption' color='textSecondary' display='block' sx={{ mb: 2 }}>
                                    Enter phone numbers and names, one recipient per line. Format: <b>Phone,Name</b>. (e.g.
                                    +20123456789,أحمد)
                                </Typography>

                                <Box sx={{ mb: 2, display: 'flex', gap: 2 }}>
                                    <input
                                        accept='.csv,.txt'
                                        style={{ display: 'none' }}
                                        id='campaign-csv-file-input'
                                        type='file'
                                        onChange={handleFileUpload}
                                    />
                                    <label htmlFor='campaign-csv-file-input'>
                                        <Button variant='outlined' color='primary' component='span' startIcon={<IconFileText />}>
                                            Upload CSV / Text File (رفع ملف)
                                        </Button>
                                    </label>

                                    <Button
                                        variant='contained'
                                        color='warning'
                                        onClick={handleValidateRecipients}
                                        disabled={isValidatingNumbers || parseRecipients(recipientsRawText).length === 0}
                                        startIcon={isValidatingNumbers ? <CircularProgress size={16} color='inherit' /> : null}
                                    >
                                        {isValidatingNumbers ? 'Validating...' : 'Validate & Filter Numbers (فحص وتصفية الأرقام)'}
                                    </Button>
                                </Box>

                                <TextField
                                    fullWidth
                                    multiline
                                    rows={10}
                                    placeholder={`+201011111111,أحمد\n+201022222222,محمد\n+966503333333,خالد`}
                                    value={recipientsRawText}
                                    onChange={(e) => setRecipientsRawText(e.target.value)}
                                    helperText={`Parsed recipients: ${parseRecipients(recipientsRawText).length}`}
                                />
                            </Grid>
                        </Grid>
                    )}
                </DialogContent>

                <DialogActions sx={{ p: 3, pt: 1 }}>
                    <Button onClick={handleCloseWizard} color='inherit'>
                        Cancel
                    </Button>
                    <Box sx={{ flexGrow: 1 }} />
                    {wizardStep > 1 && (
                        <Button onClick={() => setWizardStep((prev) => prev - 1)} variant='outlined'>
                            Back
                        </Button>
                    )}
                    {wizardStep < 3 && (
                        <Button
                            onClick={() => setWizardStep((prev) => prev + 1)}
                            variant='contained'
                            color='primary'
                            disabled={
                                (wizardStep === 1 && (!campaignName || !messageTemplate)) ||
                                (wizardStep === 2 && selectedDeviceIds.length === 0)
                            }
                        >
                            Next
                        </Button>
                    )}
                    {wizardStep === 3 && (
                        <Button
                            onClick={handleCreateCampaign}
                            variant='contained'
                            color='success'
                            disabled={parseRecipients(recipientsRawText).length === 0}
                        >
                            Launch Campaign
                        </Button>
                    )}
                </DialogActions>
            </Dialog>
        </Box>
    )
}

export default WhatsAppCampaigns
