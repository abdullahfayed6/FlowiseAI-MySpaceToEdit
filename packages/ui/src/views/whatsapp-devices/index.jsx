import React, { useEffect, useState } from 'react'
import {
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Grid,
    IconButton,
    Stack,
    TextField,
    Typography
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { IconPlus, IconTrash, IconDeviceMobile, IconRefresh } from '@tabler/icons-react'

// project imports
import ViewHeader from '@/layout/MainLayout/ViewHeader'
import whatsappApi from '@/api/whatsapp'
import useApi from '@/hooks/useApi'

const WhatsAppDevices = () => {
    const theme = useTheme()

    const [devices, setDevices] = useState([])
    const [openAddDialog, setOpenAddDialog] = useState(false)
    const [newDeviceName, setNewDeviceName] = useState('')
    const [activeQrDeviceId, setActiveQrDeviceId] = useState(null)
    const [qrCodeData, setQrCodeData] = useState(null)
    const [qrStatus, setQrStatus] = useState('INITIALIZING')
    const [qrPhoneNumber, setQrPhoneNumber] = useState(null)

    const fetchDevices = async () => {
        try {
            const res = await whatsappApi.getDevices()
            if (res && res.data) {
                setDevices(res.data)
            }
        } catch (error) {
            console.error('Error fetching WhatsApp devices:', error)
        }
    }

    useEffect(() => {
        fetchDevices()
    }, [])

    // Poll QR Code and status when dialog is open for a device
    useEffect(() => {
        let intervalId
        if (activeQrDeviceId) {
            const checkStatus = async () => {
                try {
                    const res = await whatsappApi.getDeviceQR(activeQrDeviceId)
                    if (res && res.data) {
                        setQrStatus(res.data.status)
                        setQrCodeData(res.data.qrCode)
                        setQrPhoneNumber(res.data.phoneNumber)

                        if (res.data.status === 'CONNECTED') {
                            clearInterval(intervalId)
                            setTimeout(() => {
                                handleCloseAddDialog()
                                fetchDevices()
                            }, 1000)
                        }
                    }
                } catch (err) {
                    console.error('Error checking WhatsApp QR status:', err)
                }
            }

            // check immediately
            checkStatus()
            // then check every 2 seconds
            intervalId = setInterval(checkStatus, 2000)
        }

        return () => {
            if (intervalId) clearInterval(intervalId)
        }
    }, [activeQrDeviceId])

    const handleOpenAddDialog = () => {
        setNewDeviceName('')
        setQrCodeData(null)
        setQrStatus('INITIALIZING')
        setQrPhoneNumber(null)
        setActiveQrDeviceId(null)
        setOpenAddDialog(true)
    }

    const handleCloseAddDialog = () => {
        setOpenAddDialog(false)
        setActiveQrDeviceId(null)
        setQrCodeData(null)
        fetchDevices()
    }

    const handleCreateDevice = async () => {
        if (!newDeviceName) return
        try {
            const res = await whatsappApi.addDevice({ name: newDeviceName })
            if (res && res.data) {
                setActiveQrDeviceId(res.data.id)
            } else {
                alert('No res.data! res: ' + JSON.stringify(res))
            }
        } catch (error) {
            console.error('Error creating WhatsApp device:', error)
            alert('Error creating device: ' + error.message)
        }
    }

    const handleDeleteDevice = async (id) => {
        if (window.confirm('Are you sure you want to delete this device and all its mappings?')) {
            try {
                await whatsappApi.deleteDevice(id)
                fetchDevices()
            } catch (error) {
                console.error('Error deleting WhatsApp device:', error)
            }
        }
    }

    const handleReconnectDevice = (id) => {
        setActiveQrDeviceId(id)
        setQrCodeData(null)
        setQrStatus('INITIALIZING')
        setQrPhoneNumber(null)
        setOpenAddDialog(true)
    }

    const getStatusColor = (status) => {
        switch (status) {
            case 'CONNECTED':
                return 'success'
            case 'QR':
                return 'warning'
            case 'INITIALIZING':
                return 'info'
            default:
                return 'error'
        }
    }

    return (
        <Box sx={{ p: 3 }}>
            <Stack direction='row' alignItems='center' justifyContent='space-between' sx={{ mb: 3 }}>
                <ViewHeader title='WhatsApp Devices' description='Manage your connected instances' />
                <Button variant='contained' color='primary' startIcon={<IconPlus />} onClick={handleOpenAddDialog} sx={{ borderRadius: 2 }}>
                    Add Device
                </Button>
            </Stack>

            <Grid container spacing={3}>
                {devices.length === 0 ? (
                    <Grid item xs={12}>
                        <Box sx={{ textAlign: 'center', py: 8 }}>
                            <IconDeviceMobile size={60} stroke={1.5} color={theme.palette.grey[400]} />
                            <Typography variant='h5' color='textSecondary' sx={{ mt: 2 }}>
                                No WhatsApp devices connected yet
                            </Typography>
                            <Typography variant='body2' color='textSecondary' sx={{ mt: 1 }}>
                                Click the "Add Device" button to link your WhatsApp account.
                            </Typography>
                        </Box>
                    </Grid>
                ) : (
                    devices.map((device) => (
                        <Grid item xs={12} sm={6} md={4} key={device.id}>
                            <Card sx={{ border: '1px solid', borderColor: theme.palette.grey[900] + 15, borderRadius: 3 }}>
                                <CardContent>
                                    <Stack direction='row' alignItems='center' justifyContent='space-between' spacing={2}>
                                        <Stack direction='row' alignItems='center' spacing={2}>
                                            <IconDeviceMobile size={35} color={theme.palette.primary.main} />
                                            <Box>
                                                <Typography variant='h5'>{device.name}</Typography>
                                                <Typography variant='caption' color='textSecondary'>
                                                    {device.phoneNumber ? `+${device.phoneNumber}` : 'No phone number'}
                                                </Typography>
                                            </Box>
                                        </Stack>
                                        <Chip
                                            label={device.status}
                                            color={getStatusColor(device.status)}
                                            size='small'
                                            sx={{ fontWeight: 'bold' }}
                                        />
                                    </Stack>

                                    <Stack direction='row' justifyContent='flex-end' spacing={1} sx={{ mt: 3 }}>
                                        {device.status !== 'CONNECTED' && (
                                            <IconButton
                                                color='primary'
                                                title='Connect / Get QR'
                                                onClick={() => handleReconnectDevice(device.id)}
                                            >
                                                <IconRefresh />
                                            </IconButton>
                                        )}
                                        <IconButton color='error' title='Delete Device' onClick={() => handleDeleteDevice(device.id)}>
                                            <IconTrash />
                                        </IconButton>
                                    </Stack>
                                </CardContent>
                            </Card>
                        </Grid>
                    ))
                )}
            </Grid>

            {/* Add Device / QR Dialog */}
            <Dialog open={openAddDialog} onClose={handleCloseAddDialog} maxWidth='sm' fullWidth>
                <DialogTitle sx={{ pb: 0 }}>
                    <Typography variant='h4'>{!activeQrDeviceId ? 'Add WhatsApp Device' : `Connect WhatsApp: ${newDeviceName}`}</Typography>
                </DialogTitle>
                <DialogContent>
                    {!activeQrDeviceId ? (
                        <Box sx={{ pt: 2 }}>
                            <TextField
                                autoFocus
                                fullWidth
                                label='Device Name'
                                variant='outlined'
                                value={newDeviceName}
                                onChange={(e) => setNewDeviceName(e.target.value)}
                                placeholder='e.g. My Phone, Customer Support'
                            />
                        </Box>
                    ) : (
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 4 }}>
                            {qrStatus === 'INITIALIZING' && (
                                <>
                                    <CircularProgress size={50} sx={{ mb: 2 }} />
                                    <Typography variant='body1'>Initializing WhatsApp client. Please wait...</Typography>
                                </>
                            )}
                            {qrStatus === 'QR' && qrCodeData && (
                                <>
                                    <Box
                                        component='img'
                                        src={qrCodeData}
                                        alt='WhatsApp QR Code'
                                        sx={{ width: 260, height: 260, border: '1px solid #ccc', borderRadius: 2, p: 1, mb: 2 }}
                                    />
                                    <Typography variant='body1' sx={{ fontWeight: 'bold' }}>
                                        Scan this QR Code with your WhatsApp app
                                    </Typography>
                                    <Typography variant='body2' color='textSecondary' sx={{ mt: 1 }}>
                                        Open WhatsApp &gt; Settings &gt; Linked Devices &gt; Link a Device.
                                    </Typography>
                                </>
                            )}
                            {qrStatus === 'CONNECTED' && (
                                <>
                                    <Typography variant='h4' color='success.main' sx={{ mb: 2 }}>
                                        Success!
                                    </Typography>
                                    <Typography variant='body1'>
                                        WhatsApp connected successfully for number {qrPhoneNumber ? `+${qrPhoneNumber}` : ''}.
                                    </Typography>
                                </>
                            )}
                            {qrStatus === 'DISCONNECTED' && (
                                <>
                                    <Typography variant='body1' color='error'>
                                        Failed to connect or disconnected. Click Close and try again.
                                    </Typography>
                                </>
                            )}
                        </Box>
                    )}
                </DialogContent>
                <DialogActions sx={{ p: 2, pt: 0 }}>
                    <Button onClick={handleCloseAddDialog} color='inherit'>
                        Close
                    </Button>
                    {!activeQrDeviceId && (
                        <Button onClick={handleCreateDevice} color='primary' variant='contained' disabled={!newDeviceName}>
                            Next
                        </Button>
                    )}
                </DialogActions>
            </Dialog>
        </Box>
    )
}

export default WhatsAppDevices
