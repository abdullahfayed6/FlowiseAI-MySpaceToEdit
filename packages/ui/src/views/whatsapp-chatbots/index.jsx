import { useEffect, useState } from 'react'
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
    Typography,
    FormControlLabel,
    Divider
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { IconPlus, IconTrash, IconRobot, IconEye } from '@tabler/icons-react'

// project imports
import ViewHeader from '@/layout/MainLayout/ViewHeader'
import whatsappApi from '@/api/whatsapp'
import chatflowsApi from '@/api/chatflows'

const WhatsAppChatbots = () => {
    const theme = useTheme()

    const [chatbots, setChatbots] = useState([])
    const [devices, setDevices] = useState([])
    const [chatflows, setChatflows] = useState([])

    const [openAddDialog, setOpenAddDialog] = useState(false)
    const [isEditMode, setIsEditMode] = useState(false)
    const [editingChatbotId, setEditingChatbotId] = useState('')
    const [newChatbotTitle, setNewChatbotTitle] = useState('')
    const [selectedDeviceId, setSelectedDeviceId] = useState('')
    const [selectedChatflowId, setSelectedChatflowId] = useState('')

    // Follow-up settings
    const [isFollowUpEnabled, setIsFollowUpEnabled] = useState(false)
    const [followUpDelayMinutes, setFollowUpDelayMinutes] = useState(1440)
    const [followUpSystemPrompt, setFollowUpSystemPrompt] = useState('')

    // Business Hours settings
    const [businessHoursEnabled, setBusinessHoursEnabled] = useState(false)
    const [businessHoursStart, setBusinessHoursStart] = useState('09:00')
    const [businessHoursEnd, setBusinessHoursEnd] = useState('22:00')
    const [outsideHoursMessage, setOutsideHoursMessage] = useState('')

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
        setIsEditMode(false)
        setEditingChatbotId('')
        setNewChatbotTitle('')
        setSelectedDeviceId('')
        setSelectedChatflowId('')
        setIsFollowUpEnabled(false)
        setFollowUpDelayMinutes(1440)
        setFollowUpSystemPrompt('')
        setBusinessHoursEnabled(false)
        setBusinessHoursStart('09:00')
        setBusinessHoursEnd('22:00')
        setOutsideHoursMessage('')
        setOpenAddDialog(true)
    }

    const handleOpenEditDialog = (bot) => {
        setIsEditMode(true)
        setEditingChatbotId(bot.id)
        setNewChatbotTitle(bot.title)
        setSelectedDeviceId(bot.deviceId)
        setSelectedChatflowId(bot.chatflowId)
        setIsFollowUpEnabled(bot.isFollowUpEnabled || false)
        setFollowUpDelayMinutes(bot.followUpDelayMinutes !== undefined ? bot.followUpDelayMinutes : 1440)
        setFollowUpSystemPrompt(bot.followUpSystemPrompt || '')
        setBusinessHoursEnabled(bot.businessHoursEnabled || false)
        setBusinessHoursStart(bot.businessHoursStart || '09:00')
        setBusinessHoursEnd(bot.businessHoursEnd || '22:00')
        setOutsideHoursMessage(bot.outsideHoursMessage || '')
        setOpenAddDialog(true)
    }

    const handleCloseAddDialog = () => {
        setOpenAddDialog(false)
    }

    const handleSaveChatbot = async () => {
        if (!newChatbotTitle || !selectedDeviceId || !selectedChatflowId) return
        try {
            const payload = {
                title: newChatbotTitle,
                deviceId: selectedDeviceId,
                chatflowId: selectedChatflowId,
                isFollowUpEnabled,
                followUpDelayMinutes: Number(followUpDelayMinutes),
                followUpSystemPrompt,
                businessHoursEnabled,
                businessHoursStart,
                businessHoursEnd,
                outsideHoursMessage
            }

            if (isEditMode) {
                await whatsappApi.updateChatbot(editingChatbotId, payload)
            } else {
                await whatsappApi.addChatbot(payload)
            }
            setOpenAddDialog(false)
            fetchAllData()
        } catch (error) {
            console.error('Error saving WhatsApp chatbot mapping:', error)
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
                                        <Stack
                                            direction='row'
                                            alignItems='center'
                                            spacing={1}
                                            style={{ cursor: 'pointer' }}
                                            onClick={() => handleOpenEditDialog(bot)}
                                        >
                                            <IconEye size={18} color={theme.palette.primary.main} />
                                            <Typography
                                                variant='body1'
                                                sx={{ fontWeight: 500, '&:hover': { textDecoration: 'underline' } }}
                                            >
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

            {/* Add/Edit Chatbot Dialog */}
            <Dialog open={openAddDialog} onClose={handleCloseAddDialog} maxWidth='sm' fullWidth>
                <DialogTitle>
                    <Typography variant='h4'>{isEditMode ? 'Edit Chatbot Settings' : 'Add Chatbot'}</Typography>
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

                        <FormControl fullWidth disabled={isEditMode}>
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

                        <FormControl fullWidth disabled={isEditMode}>
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

                        <Divider sx={{ my: 1 }} />

                        <FormControlLabel
                            control={
                                <Switch
                                    checked={isFollowUpEnabled}
                                    onChange={(e) => setIsFollowUpEnabled(e.target.checked)}
                                    color='primary'
                                />
                            }
                            label='Enable Auto Follow-Up (تفعيل المتابعة التلقائية)'
                        />

                        {isFollowUpEnabled && (
                            <>
                                <TextField
                                    fullWidth
                                    label='Follow-Up Delay (minutes)'
                                    type='number'
                                    variant='outlined'
                                    value={followUpDelayMinutes}
                                    onChange={(e) => setFollowUpDelayMinutes(e.target.value)}
                                    helperText='How long to wait after our last message before evaluating (e.g., 1440 for 24h, 5 for testing)'
                                />

                                <TextField
                                    fullWidth
                                    label='Follow-Up System Prompt'
                                    variant='outlined'
                                    multiline
                                    rows={8}
                                    value={followUpSystemPrompt}
                                    onChange={(e) => setFollowUpSystemPrompt(e.target.value)}
                                    placeholder={`Based on the following chat history, decide whether to send a friendly follow-up:
{chat_history}

Decision Rules:
1. Output 'Decision: YES' if they showed interest.
2. Otherwise output 'Decision: NO'.

Required Response Format:
Decision: [YES / NO]
Message: [The follow-up message text]`}
                                    helperText='Use {chat_history} to inject the chat history. The LLM must output "Decision: YES/NO" and "Message: [text]".'
                                />
                            </>
                        )}

                        <Divider sx={{ my: 1 }} />

                        <FormControlLabel
                            control={
                                <Switch
                                    checked={businessHoursEnabled}
                                    onChange={(e) => setBusinessHoursEnabled(e.target.checked)}
                                    color='primary'
                                />
                            }
                            label='Enable Business Hours (تفعيل ساعات العمل)'
                        />

                        {businessHoursEnabled && (
                            <>
                                <Stack direction='row' spacing={2}>
                                    <TextField
                                        fullWidth
                                        label='Business Hours Start'
                                        type='time'
                                        variant='outlined'
                                        value={businessHoursStart}
                                        onChange={(e) => setBusinessHoursStart(e.target.value)}
                                        InputLabelProps={{ shrink: true }}
                                    />
                                    <TextField
                                        fullWidth
                                        label='Business Hours End'
                                        type='time'
                                        variant='outlined'
                                        value={businessHoursEnd}
                                        onChange={(e) => setBusinessHoursEnd(e.target.value)}
                                        InputLabelProps={{ shrink: true }}
                                    />
                                </Stack>

                                <TextField
                                    fullWidth
                                    label='Away Message (الرسالة خارج ساعات العمل)'
                                    variant='outlined'
                                    multiline
                                    rows={4}
                                    value={outsideHoursMessage}
                                    onChange={(e) => setOutsideHoursMessage(e.target.value)}
                                    placeholder='شكراً لتواصلك! نحن حالياً خارج ساعات العمل وسنرد عليك في أقرب وقت ممكن.'
                                    helperText='This message will be sent once a day if a user contacts you outside business hours.'
                                />
                            </>
                        )}
                    </Stack>
                </DialogContent>
                <DialogActions sx={{ p: 2, pt: 0 }}>
                    <Button onClick={handleCloseAddDialog} color='inherit'>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSaveChatbot}
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
