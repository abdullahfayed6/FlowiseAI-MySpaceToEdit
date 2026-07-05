import React, { useEffect, useState } from 'react'
import {
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    IconButton,
    InputLabel,
    MenuItem,
    Paper,
    Select,
    Stack,
    Switch,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TextField,
    Typography
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { IconPlus, IconTrash, IconRobot, IconEye } from '@tabler/icons-react'

// project imports
import ViewHeader from '@/layout/MainLayout/ViewHeader'
import whatsappApi from '@/api/whatsapp'
import chatflowsApi from '@/api/chatflows'
import useApi from '@/hooks/useApi'

const WhatsAppChatbots = () => {
    const theme = useTheme()

    const [chatbots, setChatbots] = useState([])
    const [devices, setDevices] = useState([])
    const [chatflows, setChatflows] = useState([])

    const [openAddDialog, setOpenAddDialog] = useState(false)
    const [newChatbotTitle, setNewChatbotTitle] = useState('')
    const [selectedDeviceId, setSelectedDeviceId] = useState('')
    const [selectedChatflowId, setSelectedChatflowId] = useState('')

    const fetchAllData = async () => {
        try {
            const botsRes = await whatsappApi.getChatbots()
            if (botsRes && botsRes.data) setChatbots(botsRes.data)

            const devicesRes = await whatsappApi.getDevices()
            if (devicesRes && devicesRes.data) setDevices(devicesRes.data)

            const flowsRes = await chatflowsApi.getAllChatflows()
            if (flowsRes && flowsRes.data) setChatflows(flowsRes.data)
        } catch (error) {
            console.error('Error fetching WhatsApp chatbot data:', error)
        }
    }

    useEffect(() => {
        fetchAllData()
    }, [])

    const handleOpenAddDialog = () => {
        setNewChatbotTitle('')
        setSelectedDeviceId('')
        setSelectedChatflowId('')
        setOpenAddDialog(true)
    }

    const handleCloseAddDialog = () => {
        setOpenAddDialog(false)
    }

    const handleCreateChatbot = async () => {
        if (!newChatbotTitle || !selectedDeviceId || !selectedChatflowId) return
        try {
            await whatsappApi.addChatbot({
                title: newChatbotTitle,
                deviceId: selectedDeviceId,
                chatflowId: selectedChatflowId
            })
            setOpenAddDialog(false)
            fetchAllData()
        } catch (error) {
            console.error('Error creating WhatsApp chatbot mapping:', error)
        }
    }

    const handleDeleteChatbot = async (id) => {
        if (window.confirm('Are you sure you want to delete this chatbot auto-reply mapping?')) {
            try {
                await whatsappApi.deleteChatbot(id)
                fetchAllData()
            } catch (error) {
                console.error('Error deleting WhatsApp chatbot mapping:', error)
            }
        }
    }

    const handleToggleActive = async (id, currentStatus) => {
        try {
            await whatsappApi.updateChatbot(id, { isActive: !currentStatus })
            fetchAllData()
        } catch (error) {
            console.error('Error toggling WhatsApp chatbot status:', error)
        }
    }

    const getDeviceDisplay = (deviceId) => {
        const device = devices.find((d) => d.id === deviceId)
        if (!device) return 'Unknown Device'
        return `${device.name} (${device.phoneNumber ? `+${device.phoneNumber}` : 'No phone number'})`
    }

    const getChatflowName = (chatflowId) => {
        const flow = chatflows.find((f) => f.id === chatflowId)
        return flow ? flow.name : 'Unknown Flow'
    }

    return (
        <Box sx={{ p: 3 }}>
            <Stack direction='row' alignItems='center' justifyContent='space-between' sx={{ mb: 3 }}>
                <ViewHeader title='WA Chatbot' description='Setup auto replies for the Instances' />
                <Button variant='contained' color='primary' startIcon={<IconPlus />} onClick={handleOpenAddDialog} sx={{ borderRadius: 2 }}>
                    Add Chatbot
                </Button>
            </Stack>

            <TableContainer component={Paper} sx={{ borderRadius: 3, border: '1px solid', borderColor: theme.palette.grey[900] + 15 }}>
                <Table>
                    <TableHead sx={{ backgroundColor: theme.palette.grey[100] }}>
                        <TableRow>
                            <TableCell sx={{ fontWeight: 'bold' }}>SESSION TITLE</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>ORIGIN</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>CHATFLOW</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>STATUS</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>CREATED AT</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>DELETE</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {chatbots.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} align='center' sx={{ py: 6 }}>
                                    <IconRobot size={40} color={theme.palette.grey[400]} />
                                    <Typography variant='body1' color='textSecondary' sx={{ mt: 1 }}>
                                        No chatbot mappings configured yet
                                    </Typography>
                                </TableCell>
                            </TableRow>
                        ) : (
                            chatbots.map((bot) => (
                                <TableRow key={bot.id}>
                                    <TableCell>
                                        <Stack direction='row' alignItems='center' spacing={1}>
                                            <IconEye size={18} style={{ cursor: 'pointer' }} color={theme.palette.primary.main} />
                                            <Typography variant='body1' sx={{ fontWeight: 500 }}>
                                                {bot.title}
                                            </Typography>
                                        </Stack>
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant='body2' sx={{ color: theme.palette.success.main, fontWeight: 'bold' }}>
                                            {getDeviceDisplay(bot.deviceId)}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>{getChatflowName(bot.chatflowId)}</TableCell>
                                    <TableCell>
                                        <Switch
                                            checked={bot.isActive}
                                            onChange={() => handleToggleActive(bot.id, bot.isActive)}
                                            color='success'
                                        />
                                    </TableCell>
                                    <TableCell>{new Date(bot.createdDate).toLocaleDateString()}</TableCell>
                                    <TableCell>
                                        <IconButton color='error' onClick={() => handleDeleteChatbot(bot.id)}>
                                            <IconTrash />
                                        </IconButton>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </TableContainer>

            {/* Add Chatbot Dialog */}
            <Dialog open={openAddDialog} onClose={handleCloseAddDialog} maxWidth='sm' fullWidth>
                <DialogTitle>
                    <Typography variant='h4'>Add Chatbot</Typography>
                </DialogTitle>
                <DialogContent>
                    <Stack spacing={3} sx={{ pt: 2 }}>
                        <TextField
                            fullWidth
                            label='Title'
                            variant='outlined'
                            value={newChatbotTitle}
                            onChange={(e) => setNewChatbotTitle(e.target.value)}
                            placeholder='Enter webhook title...'
                        />

                        <FormControl fullWidth>
                            <InputLabel id='select-origin-label'>Select Origin (WhatsApp Device)</InputLabel>
                            <Select
                                labelId='select-origin-label'
                                value={selectedDeviceId}
                                label='Select Origin (WhatsApp Device)'
                                onChange={(e) => setSelectedDeviceId(e.target.value)}
                            >
                                {devices.map((device) => (
                                    <MenuItem key={device.id} value={device.id} disabled={device.status !== 'CONNECTED'}>
                                        {device.name} {device.phoneNumber ? `(+${device.phoneNumber})` : '(Not Connected)'}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <FormControl fullWidth>
                            <InputLabel id='select-flow-label'>Select Automation Flow (Chatflow)</InputLabel>
                            <Select
                                labelId='select-flow-label'
                                value={selectedChatflowId}
                                label='Select Automation Flow (Chatflow)'
                                onChange={(e) => setSelectedChatflowId(e.target.value)}
                            >
                                {chatflows.map((flow) => (
                                    <MenuItem key={flow.id} value={flow.id}>
                                        {flow.name}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Stack>
                </DialogContent>
                <DialogActions sx={{ p: 2, pt: 0 }}>
                    <Button onClick={handleCloseAddDialog} color='inherit'>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleCreateChatbot}
                        color='success'
                        variant='contained'
                        disabled={!newChatbotTitle || !selectedDeviceId || !selectedChatflowId}
                    >
                        Save Changes
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    )
}

export default WhatsAppChatbots
