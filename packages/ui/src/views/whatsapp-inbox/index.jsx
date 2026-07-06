import { useEffect, useState, useRef } from 'react'
import {
    Box,
    Card,
    Divider,
    FormControl,
    Grid,
    IconButton,
    InputLabel,
    List,
    ListItemButton,
    ListItemText,
    MenuItem,
    Paper,
    Select,
    Stack,
    TextField,
    Typography
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { IconSend, IconMessageCircle, IconRefresh, IconTrash } from '@tabler/icons-react'
import moment from 'moment'

// project imports
import ViewHeader from '@/layout/MainLayout/ViewHeader'
import whatsappApi from '@/api/whatsapp'
import useNotifier from '@/utils/useNotifier'

const WhatsAppInbox = () => {
    const theme = useTheme()
    useNotifier()

    const [devices, setDevices] = useState([])
    const [selectedDeviceId, setSelectedDeviceId] = useState('')

    const [chats, setChats] = useState([])
    const [selectedChat, setSelectedChat] = useState(null)

    const [messages, setMessages] = useState([])
    const [messageInput, setMessageInput] = useState('')

    const [loadingChats, setLoadingChats] = useState(false)
    const [loadingMessages, setLoadingMessages] = useState(false)
    const messagesEndRef = useRef(null)

    // Fetch connected devices on load
    useEffect(() => {
        const fetchDevices = async () => {
            try {
                const res = await whatsappApi.getDevices()
                if (res && res.data) {
                    const connected = res.data.filter((d) => d.status === 'CONNECTED')
                    setDevices(connected)
                    if (connected.length > 0) {
                        setSelectedDeviceId(connected[0].id)
                    }
                }
            } catch (error) {
                console.error('Error fetching devices', error)
            }
        }
        fetchDevices()
    }, [])

    // Fetch chats when device changes
    const fetchChats = async () => {
        if (!selectedDeviceId) return
        setLoadingChats(true)
        try {
            const res = await whatsappApi.getChats(selectedDeviceId)
            if (res && res.data) {
                setChats(res.data.sort((a, b) => b.timestamp - a.timestamp))
            }
        } catch (error) {
            console.error('Error fetching chats', error)
        } finally {
            setLoadingChats(false)
        }
    }

    useEffect(() => {
        fetchChats()
        setSelectedChat(null)
        setMessages([])
    }, [selectedDeviceId])

    // Fetch messages for selected chat
    const fetchMessages = async (showLoading = true) => {
        if (!selectedDeviceId || !selectedChat) return
        if (showLoading) setLoadingMessages(true)
        try {
            const res = await whatsappApi.getMessages(selectedDeviceId, selectedChat.id)
            if (res && res.data) {
                setMessages(res.data.sort((a, b) => a.timestamp - b.timestamp))
            }
        } catch (error) {
            console.error('Error fetching messages', error)
        } finally {
            if (showLoading) setLoadingMessages(false)
        }
    }

    useEffect(() => {
        if (selectedChat) {
            fetchMessages()
        }
    }, [selectedChat])

    // Poll messages every 10 seconds if chat is active
    useEffect(() => {
        let interval
        if (selectedChat) {
            interval = setInterval(() => {
                fetchMessages(false) // Fetch silently
            }, 10000)
        }
        return () => clearInterval(interval)
    }, [selectedChat, selectedDeviceId])

    // Scroll to bottom when messages change
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    const handleSendMessage = async () => {
        if (!messageInput.trim() || !selectedChat) return
        const text = messageInput
        setMessageInput('')

        // Optimistic UI update
        const tempMsg = {
            id: `temp_${Date.now()}`,
            body: text,
            fromMe: true,
            timestamp: Math.floor(Date.now() / 1000)
        }
        setMessages((prev) => [...prev, tempMsg])

        try {
            const res = await whatsappApi.sendMessage(selectedDeviceId, selectedChat.id, text)
            if (res && res.data) {
                // replace temp message or just fetch again
                fetchMessages(false)
            }
        } catch (error) {
            console.error('Error sending message', error)
            // Revert optimistic update on failure could be handled here
        }
    }

    const handleDeleteChat = async (chatId) => {
        if (!selectedDeviceId) return
        try {
            await whatsappApi.deleteChat(selectedDeviceId, chatId)
            setSelectedChat(null)
            setMessages([])
            fetchChats()
        } catch (error) {
            console.error('Error deleting chat', error)
        }
    }

    return (
        <Box>
            <ViewHeader title='WhatsApp Inbox' />
            <Box sx={{ mb: 3 }}>
                <Grid container spacing={2} alignItems='center'>
                    <Grid item xs={12} sm={4}>
                        <FormControl fullWidth>
                            <InputLabel id='device-select-label'>Select Device</InputLabel>
                            <Select
                                labelId='device-select-label'
                                value={selectedDeviceId}
                                label='Select Device'
                                onChange={(e) => setSelectedDeviceId(e.target.value)}
                            >
                                {devices.map((device) => (
                                    <MenuItem key={device.id} value={device.id}>
                                        {device.name} ({device.phoneNumber || 'No number'})
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item>
                        <IconButton onClick={fetchChats} color='primary' disabled={loadingChats}>
                            <IconRefresh />
                        </IconButton>
                    </Grid>
                </Grid>
            </Box>

            <Grid container spacing={2} sx={{ height: '70vh' }}>
                {/* Left Pane - Chats List */}
                <Grid item xs={4} sx={{ height: '100%' }}>
                    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                        <Box sx={{ p: 2, bgcolor: theme.palette.primary.light, color: theme.palette.primary.main }}>
                            <Typography variant='h6'>Chats</Typography>
                        </Box>
                        <Divider />
                        <List sx={{ flexGrow: 1, overflowY: 'auto', p: 0 }}>
                            {loadingChats ? (
                                <Box sx={{ p: 2, textAlign: 'center' }}>
                                    <Typography>Loading...</Typography>
                                </Box>
                            ) : chats.length === 0 ? (
                                <Box sx={{ p: 2, textAlign: 'center' }}>
                                    <Typography>No chats found.</Typography>
                                </Box>
                            ) : (
                                chats.map((chat) => (
                                    <ListItemButton
                                        key={chat.id}
                                        selected={selectedChat?.id === chat.id}
                                        onClick={() => setSelectedChat(chat)}
                                        sx={{ borderBottom: 1, borderColor: 'divider' }}
                                    >
                                        <ListItemText
                                            primary={chat.name}
                                            secondary={chat.timestamp ? moment.unix(chat.timestamp).fromNow() : ''}
                                            primaryTypographyProps={{ fontWeight: chat.unreadCount > 0 ? 'bold' : 'normal' }}
                                        />
                                        {chat.unreadCount > 0 && (
                                            <Box sx={{ bgcolor: 'error.main', color: 'white', borderRadius: '10px', px: 1, ml: 1 }}>
                                                <Typography variant='caption'>{chat.unreadCount}</Typography>
                                            </Box>
                                        )}
                                    </ListItemButton>
                                ))
                            )}
                        </List>
                    </Card>
                </Grid>

                {/* Right Pane - Chat Window */}
                <Grid item xs={8} sx={{ height: '100%' }}>
                    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                        {selectedChat ? (
                            <>
                                <Box
                                    sx={{
                                        p: 2,
                                        bgcolor: theme.palette.primary.light,
                                        color: theme.palette.primary.main,
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                    }}
                                >
                                    <Typography variant='h6'>{selectedChat.name}</Typography>
                                    <IconButton size='small' color='error' onClick={() => handleDeleteChat(selectedChat.id)}>
                                        <IconTrash size={20} />
                                    </IconButton>
                                </Box>
                                <Divider />
                                <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 2, bgcolor: '#f5f5f5' }}>
                                    {loadingMessages ? (
                                        <Typography align='center'>Loading messages...</Typography>
                                    ) : (
                                        messages.map((msg) => (
                                            <Box
                                                key={msg.id}
                                                sx={{
                                                    display: 'flex',
                                                    justifyContent: msg.fromMe ? 'flex-end' : 'flex-start',
                                                    mb: 2
                                                }}
                                            >
                                                <Paper
                                                    elevation={1}
                                                    sx={{
                                                        p: 1.5,
                                                        maxWidth: '70%',
                                                        bgcolor: msg.fromMe ? '#dcf8c6' : '#ffffff',
                                                        borderRadius: 2
                                                    }}
                                                >
                                                    <Typography variant='body1' sx={{ wordBreak: 'break-word' }}>
                                                        {msg.body}
                                                    </Typography>
                                                    <Typography
                                                        variant='caption'
                                                        sx={{ display: 'block', textAlign: 'right', mt: 0.5, color: 'text.secondary' }}
                                                    >
                                                        {msg.timestamp ? moment.unix(msg.timestamp).format('HH:mm') : ''}
                                                    </Typography>
                                                </Paper>
                                            </Box>
                                        ))
                                    )}
                                    <div ref={messagesEndRef} />
                                </Box>
                                <Divider />
                                <Box sx={{ p: 2, bgcolor: 'background.paper' }}>
                                    <Stack direction='row' spacing={1}>
                                        <TextField
                                            fullWidth
                                            size='small'
                                            placeholder='Type a message...'
                                            value={messageInput}
                                            onChange={(e) => setMessageInput(e.target.value)}
                                            onKeyPress={(e) => {
                                                if (e.key === 'Enter') handleSendMessage()
                                            }}
                                        />
                                        <IconButton color='primary' onClick={handleSendMessage} disabled={!messageInput.trim()}>
                                            <IconSend />
                                        </IconButton>
                                    </Stack>
                                </Box>
                            </>
                        ) : (
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    height: '100%',
                                    flexDirection: 'column'
                                }}
                            >
                                <IconMessageCircle size={64} color={theme.palette.text.secondary} />
                                <Typography variant='h6' color='textSecondary' sx={{ mt: 2 }}>
                                    Select a chat to start messaging
                                </Typography>
                            </Box>
                        )}
                    </Card>
                </Grid>
            </Grid>
        </Box>
    )
}

export default WhatsAppInbox
