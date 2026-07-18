import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    Divider,
    Grid,
    IconButton,
    Paper,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Typography,
    LinearProgress
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { IconArrowLeft, IconPlayerPlay, IconPlayerPause, IconTrash, IconDeviceMobile } from '@tabler/icons-react'
import moment from 'moment'

// project imports
import whatsappApi from '@/api/whatsapp'
import useNotifier from '@/utils/useNotifier'

const CampaignDetails = () => {
    const theme = useTheme()
    const { id } = useParams()
    const navigate = useNavigate()
    useNotifier()

    const [campaign, setCampaign] = useState(null)
    const [recipients, setRecipients] = useState([])
    const [devices, setDevices] = useState([])
    const [loading, setLoading] = useState(true)
    const pollingIntervalRef = useRef(null)

    const fetchDevices = async () => {
        try {
            const res = await whatsappApi.getDevices()
            if (res && res.data) {
                setDevices(res.data)
            }
        } catch (error) {
            console.error('Error fetching devices:', error)
        }
    }

    const fetchCampaignDetails = async (showLoading = false) => {
        if (showLoading) setLoading(true)
        try {
            const res = await whatsappApi.getCampaign(id)
            if (res && res.data) {
                setCampaign(res.data)
                setRecipients(res.data.recipients || [])
            }
        } catch (error) {
            console.error('Error fetching campaign details:', error)
            alert('Failed to load campaign details')
            navigate('/whatsapp-campaigns')
        } finally {
            if (showLoading) setLoading(false)
        }
    }

    useEffect(() => {
        fetchDevices()
        fetchCampaignDetails(true)
    }, [id])

    // Poll campaign data if running
    useEffect(() => {
        if (campaign && campaign.status === 'RUNNING') {
            if (!pollingIntervalRef.current) {
                pollingIntervalRef.current = setInterval(() => {
                    fetchCampaignDetails(false)
                }, 3000)
            }
        } else {
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current)
                pollingIntervalRef.current = null
            }
        }

        return () => {
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current)
            }
        }
    }, [campaign])

    const handleStartCampaign = async () => {
        try {
            await whatsappApi.startCampaign(id)
            fetchCampaignDetails(false)
        } catch (error) {
            console.error('Error starting campaign:', error)
        }
    }

    const handlePauseCampaign = async () => {
        try {
            await whatsappApi.pauseCampaign(id)
            fetchCampaignDetails(false)
        } catch (error) {
            console.error('Error pausing campaign:', error)
        }
    }

    const handleDeleteCampaign = async () => {
        if (window.confirm(`Are you sure you want to delete campaign "${campaign?.name}"?`)) {
            try {
                await whatsappApi.deleteCampaign(id)
                navigate('/whatsapp-campaigns')
            } catch (error) {
                console.error('Error deleting campaign:', error)
            }
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

    const getDeviceName = (deviceId) => {
        const dev = devices.find((d) => d.id === deviceId)
        return dev ? dev.name : 'Unknown Device'
    }

    const getProgressValue = () => {
        if (!campaign || !campaign.totalRecipients) return 0
        return Math.round(((campaign.sentCount + campaign.failedCount) / campaign.totalRecipients) * 100)
    }

    if (loading || !campaign) {
        return (
            <Box sx={{ p: 3, textAlign: 'center' }}>
                <Typography>Loading campaign details...</Typography>
            </Box>
        )
    }

    const progress = getProgressValue()
    let campaignDevices = []
    try {
        campaignDevices = JSON.parse(campaign.deviceIds)
    } catch (e) {
        // ignore
    }

    return (
        <Box sx={{ p: 3 }}>
            {/* Header */}
            <Stack direction='row' alignItems='center' spacing={2} sx={{ mb: 3 }}>
                <IconButton onClick={() => navigate('/whatsapp-campaigns')} color='primary'>
                    <IconArrowLeft />
                </IconButton>
                <Box sx={{ flexGrow: 1 }}>
                    <Typography variant='h3' sx={{ fontWeight: 'bold' }}>
                        {campaign.name}
                    </Typography>
                    <Typography variant='caption' color='textSecondary'>
                        Campaign ID: {campaign.id}
                    </Typography>
                </Box>
                <Chip
                    label={campaign.status}
                    color={getStatusColor(campaign.status)}
                    sx={{ fontWeight: 'bold', px: 1.5, py: 0.5, borderRadius: 2 }}
                />
            </Stack>

            <Grid container spacing={3}>
                {/* Statistics Cards */}
                <Grid item xs={12} md={3}>
                    <Card sx={{ bgcolor: theme.palette.primary.light + '20', borderRadius: 3 }}>
                        <CardContent>
                            <Typography variant='h5' color='primary' sx={{ mb: 1, fontWeight: 'bold' }}>
                                Total Recipients
                            </Typography>
                            <Typography variant='h2' sx={{ fontWeight: 'bold' }}>
                                {campaign.totalRecipients}
                            </Typography>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid item xs={12} md={3}>
                    <Card sx={{ bgcolor: theme.palette.success.light + '20', borderRadius: 3 }}>
                        <CardContent>
                            <Typography variant='h5' color='success.main' sx={{ mb: 1, fontWeight: 'bold' }}>
                                Sent Successfully
                            </Typography>
                            <Typography variant='h2' color='success.main' sx={{ fontWeight: 'bold' }}>
                                {campaign.sentCount}
                            </Typography>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid item xs={12} md={3}>
                    <Card sx={{ bgcolor: theme.palette.error.light + '20', borderRadius: 3 }}>
                        <CardContent>
                            <Typography variant='h5' color='error.main' sx={{ mb: 1, fontWeight: 'bold' }}>
                                Failed
                            </Typography>
                            <Typography variant='h2' color='error.main' sx={{ fontWeight: 'bold' }}>
                                {campaign.failedCount}
                            </Typography>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid item xs={12} md={3}>
                    <Card sx={{ bgcolor: theme.palette.grey[100], borderRadius: 3 }}>
                        <CardContent>
                            <Typography variant='h5' sx={{ mb: 1, fontWeight: 'bold' }}>
                                Progress Percentage
                            </Typography>
                            <Typography variant='h2' sx={{ fontWeight: 'bold' }}>
                                {progress}%
                            </Typography>
                        </CardContent>
                    </Card>
                </Grid>

                {/* Progress bar and controls */}
                <Grid item xs={12}>
                    <Paper sx={{ p: 3, borderRadius: 3, border: '1px solid', borderColor: theme.palette.grey[900] + 15 }}>
                        <Grid container spacing={3} alignItems='center'>
                            <Grid item xs={12} md={8}>
                                <Stack spacing={1}>
                                    <Typography variant='h5' sx={{ fontWeight: 'bold' }}>
                                        Campaign Execution Progress
                                    </Typography>
                                    <LinearProgress variant='determinate' value={progress} sx={{ height: 10, borderRadius: 5 }} />
                                </Stack>
                            </Grid>
                            <Grid item xs={12} md={4}>
                                <Stack direction='row' justifyContent='flex-end' spacing={2}>
                                    {campaign.status !== 'RUNNING' && campaign.status !== 'COMPLETED' && (
                                        <Button
                                            variant='contained'
                                            color='success'
                                            startIcon={<IconPlayerPlay />}
                                            onClick={handleStartCampaign}
                                            sx={{ borderRadius: 2 }}
                                        >
                                            Start / Resume
                                        </Button>
                                    )}
                                    {campaign.status === 'RUNNING' && (
                                        <Button
                                            variant='contained'
                                            color='warning'
                                            startIcon={<IconPlayerPause />}
                                            onClick={handlePauseCampaign}
                                            sx={{ borderRadius: 2 }}
                                        >
                                            Pause Campaign
                                        </Button>
                                    )}
                                    <Button
                                        variant='outlined'
                                        color='error'
                                        startIcon={<IconTrash />}
                                        onClick={handleDeleteCampaign}
                                        sx={{ borderRadius: 2 }}
                                    >
                                        Delete
                                    </Button>
                                </Stack>
                            </Grid>
                        </Grid>

                        <Divider sx={{ my: 2 }} />

                        {/* Configuration Info */}
                        <Grid container spacing={3}>
                            <Grid item xs={12} sm={4}>
                                <Typography variant='body2' color='textSecondary'>
                                    <b>Base Delay:</b> {campaign.baseDelay} seconds
                                </Typography>
                            </Grid>
                            <Grid item xs={12} sm={4}>
                                <Typography variant='body2' color='textSecondary'>
                                    <b>Jitter range:</b> +{campaign.jitter} seconds random delay
                                </Typography>
                            </Grid>
                            <Grid item xs={12} sm={4}>
                                <Typography variant='body2' color='textSecondary'>
                                    <b>Daily device limit:</b> Max {campaign.dailyLimit} messages
                                </Typography>
                            </Grid>
                            <Grid item xs={12}>
                                <Typography variant='body2' color='textSecondary' sx={{ mt: 1 }}>
                                    <b>Load Balancing across:</b>{' '}
                                    {campaignDevices.map((id, index) => (
                                        <Chip
                                            key={id}
                                            size='small'
                                            icon={<IconDeviceMobile size={14} />}
                                            label={getDeviceName(id)}
                                            variant='outlined'
                                            sx={{ mr: 1, mb: 1 }}
                                        />
                                    ))}
                                </Typography>
                            </Grid>
                            <Grid item xs={12}>
                                <Typography variant='body2' color='textSecondary' sx={{ mt: 1 }}>
                                    <b>Message Template:</b>
                                </Typography>
                                <Typography
                                    variant='body2'
                                    sx={{
                                        p: 2,
                                        bgcolor: theme.palette.grey[50],
                                        borderRadius: 2,
                                        border: '1px solid',
                                        borderColor: theme.palette.grey[200],
                                        fontFamily: 'monospace',
                                        whiteSpace: 'pre-wrap',
                                        mt: 0.5
                                    }}
                                >
                                    {campaign.messageTemplate}
                                </Typography>
                            </Grid>
                        </Grid>
                    </Paper>
                </Grid>

                {/* Dispatch logs */}
                <Grid item xs={12}>
                    <Typography variant='h4' sx={{ mb: 2, fontWeight: 'bold' }}>
                        Dispatch Logs (سجل الإرسال التفصيلي)
                    </Typography>
                    <TableContainer
                        component={Paper}
                        sx={{ borderRadius: 3, border: '1px solid', borderColor: theme.palette.grey[900] + 15 }}
                    >
                        <Table>
                            <TableHead sx={{ backgroundColor: theme.palette.grey[100] }}>
                                <TableRow>
                                    <TableCell sx={{ fontWeight: 'bold' }}>PHONE NUMBER</TableCell>
                                    <TableCell sx={{ fontWeight: 'bold' }}>RECIPIENT NAME</TableCell>
                                    <TableCell sx={{ fontWeight: 'bold' }}>STATUS</TableCell>
                                    <TableCell sx={{ fontWeight: 'bold' }}>SENT VIA DEVICE</TableCell>
                                    <TableCell sx={{ fontWeight: 'bold' }}>TIMESTAMP</TableCell>
                                    <TableCell sx={{ fontWeight: 'bold' }}>REMARKS / ERROR</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {recipients.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} align='center' sx={{ py: 6 }}>
                                            No recipients imported
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    recipients.map((rec) => (
                                        <TableRow key={rec.id}>
                                            <TableCell sx={{ fontWeight: 500 }}>{rec.phoneNumber}</TableCell>
                                            <TableCell>{rec.name || '-'}</TableCell>
                                            <TableCell>
                                                <Chip
                                                    label={rec.status}
                                                    color={
                                                        rec.status === 'SENT' ? 'success' : rec.status === 'FAILED' ? 'error' : 'secondary'
                                                    }
                                                    size='small'
                                                    sx={{ fontWeight: 'bold' }}
                                                />
                                            </TableCell>
                                            <TableCell>
                                                {rec.sentDeviceId ? (
                                                    <Chip
                                                        icon={<IconDeviceMobile size={14} />}
                                                        label={getDeviceName(rec.sentDeviceId)}
                                                        variant='outlined'
                                                        size='small'
                                                    />
                                                ) : (
                                                    '-'
                                                )}
                                            </TableCell>
                                            <TableCell>{rec.sentDate ? moment(rec.sentDate).format('YYYY-MM-DD HH:mm:ss') : '-'}</TableCell>
                                            <TableCell sx={{ color: theme.palette.error.main, maxWidth: 300, wordBreak: 'break-word' }}>
                                                {rec.errorMessage || '-'}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Grid>
            </Grid>
        </Box>
    )
}

export default CampaignDetails
