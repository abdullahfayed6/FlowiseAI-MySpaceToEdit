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
    Typography,
    Switch,
    FormControlLabel
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import {
    IconSend,
    IconMessageCircle,
    IconRefresh,
    IconTrash,
    IconPaperclip,
    IconX,
    IconMicrophone,
    IconPlayerStop
} from '@tabler/icons-react'
import moment from 'moment'

// project imports
import ViewHeader from '@/layout/MainLayout/ViewHeader'
import whatsappApi from '@/api/whatsapp'
import useNotifier from '@/utils/useNotifier'

const AudioPlayer = ({ deviceId, chatId, messageId }) => {
    const [audioUrl, setAudioUrl] = useState('')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(false)

    useEffect(() => {
        let url = ''
        const fetchAudio = async () => {
            try {
                const response = await whatsappApi.getMessageMedia(deviceId, chatId, messageId)
                url = URL.createObjectURL(response.data)
                setAudioUrl(url)
            } catch (err) {
                console.error('Failed to load audio message:', err)
                setError(true)
            } finally {
                setLoading(false)
            }
        }
        fetchAudio()

        return () => {
            if (url) URL.revokeObjectURL(url)
        }
    }, [deviceId, chatId, messageId])

    if (loading)
        return (
            <Typography variant='caption' sx={{ display: 'block', minWidth: 200, color: 'text.secondary' }}>
                Loading voice message...
            </Typography>
        )
    if (error)
        return (
            <Typography variant='caption' sx={{ display: 'block', minWidth: 200, color: 'error.main' }}>
                Failed to load voice message
            </Typography>
        )

    return (
        <Box sx={{ mt: 0.5, minWidth: 240 }}>
            <audio controls src={audioUrl} style={{ width: '100%', height: '40px' }} />
        </Box>
    )
}

const formatMessageTime = (timestamp) => {
    if (!timestamp) return ''
    const val = Number(timestamp)
    return val > 9999999999 ? moment(val).format('HH:mm') : moment.unix(val).format('HH:mm')
}

const WhatsAppInbox = () => {
    const theme = useTheme()
    useNotifier()

    const [devices, setDevices] = useState([])
    const [selectedDeviceId, setSelectedDeviceId] = useState('')

    const [chats, setChats] = useState([])
    const [selectedChat, setSelectedChat] = useState(null)

    const [messages, setMessages] = useState([])
    const [messageInput, setMessageInput] = useState('')
    const [selectedFile, setSelectedFile] = useState(null)

    // Voice recording states
    const [isRecording, setIsRecording] = useState(false)
    const [mediaRecorder, setMediaRecorder] = useState(null)
    const [recordingDuration, setRecordingDuration] = useState(0)
    const [recordingIntervalId, setRecordingIntervalId] = useState(null)

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            const recorder = new MediaRecorder(stream)
            const chunks = []

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    chunks.push(e.data)
                }
            }

            recorder.onstop = () => {
                const blob = new Blob(chunks, { type: 'audio/webm' })
                const file = new File([blob], 'voice-message.webm', { type: 'audio/webm' })
                setSelectedFile(file)
                stream.getTracks().forEach((track) => track.stop())
            }

            recorder.start()
            setMediaRecorder(recorder)
            setIsRecording(true)
            setRecordingDuration(0)

            const interval = setInterval(() => {
                setRecordingDuration((prev) => prev + 1)
            }, 1000)
            setRecordingIntervalId(interval)
        } catch (error) {
            console.error('Error starting audio recording:', error)
        }
    }

    const stopRecording = (shouldSave = true) => {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            if (!shouldSave) {
                mediaRecorder.onstop = () => {
                    mediaRecorder.stream.getTracks().forEach((track) => track.stop())
                }
            }
            mediaRecorder.stop()
        }
        if (recordingIntervalId) {
            clearInterval(recordingIntervalId)
            setRecordingIntervalId(null)
        }
        setIsRecording(false)
        setMediaRecorder(null)
    }

    const formatDuration = (seconds) => {
        const mins = Math.floor(seconds / 60)
        const secs = seconds % 60
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }

    const handleFileChange = (e) => {
        if (e.target.files && e.target.files.length > 0) {
            const file = e.target.files[0]
            setSelectedFile(file)
        }
    }

    const fileToBase64 = (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.readAsDataURL(file)
            reader.onload = () => resolve(reader.result)
            reader.onerror = (error) => reject(error)
        })
    }

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
                setMessages(res.data)
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
        if ((!messageInput.trim() && !selectedFile) || !selectedChat) return
        const text = messageInput
        const file = selectedFile
        setMessageInput('')
        setSelectedFile(null)

        // Optimistic UI update
        let optimisticBody = text
        if (file) {
            if (file.type.startsWith('image/')) {
                optimisticBody = text ? `📷 ${text}` : '📷 Photo'
            } else if (file.type.startsWith('video/')) {
                optimisticBody = text ? `🎥 ${text}` : '🎥 Video'
            } else if (file.type.startsWith('audio/')) {
                optimisticBody = '🎵 Audio message'
            } else {
                optimisticBody = `📄 Document: ${file.name}` + (text ? ` (${text})` : '')
            }
        }

        const tempMsg = {
            id: `temp_${Date.now()}`,
            body: optimisticBody,
            fromMe: true,
            timestamp: Math.floor(Date.now() / 1000)
        }
        setMessages((prev) => [...prev, tempMsg])

        try {
            let filePayload = null
            if (file) {
                const base64Data = await fileToBase64(file)
                filePayload = {
                    data: base64Data,
                    name: file.name,
                    mimeType: file.type
                }
            }

            const res = await whatsappApi.sendMessage(selectedDeviceId, selectedChat.id, text, filePayload)
            if (res && res.data) {
                // Update local chat isPaused state to true (AI Off / Manual) since human replied
                const updatedChat = { ...selectedChat, isPaused: true }
                setSelectedChat(updatedChat)
                setChats((prev) => prev.map((c) => (c.id === selectedChat.id ? updatedChat : c)))

                const serverTs = res.data.timestamp
                    ? typeof res.data.timestamp === 'object' && res.data.timestamp.low
                        ? res.data.timestamp.low
                        : Number(res.data.timestamp)
                    : Math.floor(Date.now() / 1000)
                const actualMsg = {
                    id: res.data.id,
                    body: res.data.body,
                    fromMe: true,
                    timestamp: serverTs
                }
                setMessages((prev) => {
                    const filtered = prev.filter((m) => !m.id.startsWith('temp_'))
                    return [...filtered, actualMsg].sort((a, b) => a.timestamp - b.timestamp)
                })
            }
        } catch (error) {
            console.error('Error sending message', error)
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
                                        onClick={() => {
                                            setSelectedChat({ ...chat, unreadCount: 0 })
                                            setChats((prev) => prev.map((c) => (c.id === chat.id ? { ...c, unreadCount: 0 } : c)))
                                        }}
                                        sx={{ borderBottom: 1, borderColor: 'divider' }}
                                    >
                                        <ListItemText
                                            primary={chat.name}
                                            secondary={
                                                <Stack direction='row' spacing={1} alignItems='center' sx={{ mt: 0.5 }}>
                                                    <span>{chat.timestamp ? moment.unix(chat.timestamp).fromNow() : ''}</span>
                                                    {chat.isPaused && (
                                                        <Typography
                                                            variant='caption'
                                                            sx={{
                                                                color: 'error.main',
                                                                border: '1px solid',
                                                                borderColor: 'error.main',
                                                                borderRadius: '4px',
                                                                px: 0.5,
                                                                py: 0.1,
                                                                fontWeight: 'bold',
                                                                fontSize: '10px'
                                                            }}
                                                        >
                                                            Manual
                                                        </Typography>
                                                    )}
                                                </Stack>
                                            }
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
                                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                        <Typography variant='h6' sx={{ mr: 2, fontWeight: 'bold' }}>
                                            {selectedChat.name}
                                        </Typography>
                                        <FormControlLabel
                                            control={
                                                <Switch
                                                    checked={!selectedChat.isPaused}
                                                    size='small'
                                                    onChange={async (e) => {
                                                        const targetChecked = e.target.checked
                                                        const isPausedVal = !targetChecked
                                                        try {
                                                            await whatsappApi.toggleChatAI(selectedDeviceId, selectedChat.id, isPausedVal)
                                                            const updatedChat = { ...selectedChat, isPaused: isPausedVal }
                                                            setSelectedChat(updatedChat)
                                                            setChats((prev) =>
                                                                prev.map((c) => (c.id === selectedChat.id ? updatedChat : c))
                                                            )
                                                        } catch (err) {
                                                            console.error('Error toggling AI mode', err)
                                                        }
                                                    }}
                                                    color='secondary'
                                                />
                                            }
                                            label={selectedChat.isPaused ? 'AI Off (Manual)' : 'AI On (Auto-Pilot)'}
                                            sx={{
                                                '& .MuiFormControlLabel-label': {
                                                    fontSize: '0.75rem',
                                                    fontWeight: 'bold',
                                                    color: selectedChat.isPaused ? 'error.main' : 'success.main'
                                                }
                                            }}
                                        />
                                    </Box>
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
                                                    {msg.body === '🎵 Audio message' || msg.body?.startsWith('🎵 Audio message') ? (
                                                        <AudioPlayer
                                                            deviceId={selectedDeviceId}
                                                            chatId={selectedChat.id}
                                                            messageId={msg.id}
                                                        />
                                                    ) : (
                                                        <Typography variant='body1' sx={{ wordBreak: 'break-word' }}>
                                                            {msg.body}
                                                        </Typography>
                                                    )}
                                                    <Typography
                                                        variant='caption'
                                                        sx={{ display: 'block', textAlign: 'right', mt: 0.5, color: 'text.secondary' }}
                                                    >
                                                        {formatMessageTime(msg.timestamp)}
                                                    </Typography>
                                                </Paper>
                                            </Box>
                                        ))
                                    )}
                                    <div ref={messagesEndRef} />
                                </Box>
                                <Divider />
                                <Box sx={{ p: 2, bgcolor: 'background.paper' }}>
                                    {selectedFile && (
                                        <Box
                                            sx={{
                                                px: 2,
                                                py: 1,
                                                display: 'flex',
                                                alignItems: 'center',
                                                bgcolor: theme.palette.grey[100],
                                                borderRadius: '8px',
                                                mb: 1,
                                                width: 'fit-content'
                                            }}
                                        >
                                            <Typography variant='body2' sx={{ mr: 1, fontWeight: 'bold' }}>
                                                📎 {selectedFile.name} ({Math.round(selectedFile.size / 1024)} KB)
                                            </Typography>
                                            <IconButton size='small' onClick={() => setSelectedFile(null)} color='error'>
                                                <IconX size={16} />
                                            </IconButton>
                                        </Box>
                                    )}
                                    <Stack direction='row' spacing={1} alignItems='center'>
                                        {isRecording ? (
                                            <>
                                                <Box sx={{ display: 'flex', alignItems: 'center', flexGrow: 1, gap: 1, pl: 1 }}>
                                                    <Box
                                                        sx={{
                                                            width: 10,
                                                            height: 10,
                                                            borderRadius: '50%',
                                                            bgcolor: 'error.main',
                                                            animation: 'pulse 1s infinite',
                                                            '@keyframes pulse': {
                                                                '0%': { opacity: 0.3 },
                                                                '50%': { opacity: 1 },
                                                                '100%': { opacity: 0.3 }
                                                            }
                                                        }}
                                                    />
                                                    <Typography color='error.main' sx={{ fontWeight: 'bold' }}>
                                                        Recording: {formatDuration(recordingDuration)}
                                                    </Typography>
                                                </Box>
                                                <IconButton color='error' onClick={() => stopRecording(false)} title='Discard recording'>
                                                    <IconTrash />
                                                </IconButton>
                                                <IconButton color='success' onClick={() => stopRecording(true)} title='Save recording'>
                                                    <IconPlayerStop />
                                                </IconButton>
                                            </>
                                        ) : (
                                            <>
                                                <input
                                                    accept='*/*'
                                                    style={{ display: 'none' }}
                                                    id='whatsapp-inbox-file-input'
                                                    type='file'
                                                    onChange={handleFileChange}
                                                />
                                                <label htmlFor='whatsapp-inbox-file-input'>
                                                    <IconButton color='secondary' component='span' title='Attach file'>
                                                        <IconPaperclip />
                                                    </IconButton>
                                                </label>
                                                <TextField
                                                    fullWidth
                                                    size='small'
                                                    placeholder={selectedFile ? 'Type a caption (optional)...' : 'Type a message...'}
                                                    value={messageInput}
                                                    onChange={(e) => setMessageInput(e.target.value)}
                                                    onKeyPress={(e) => {
                                                        if (e.key === 'Enter') handleSendMessage()
                                                    }}
                                                />
                                                <IconButton color='secondary' onClick={startRecording} title='Record voice message'>
                                                    <IconMicrophone />
                                                </IconButton>
                                                <IconButton
                                                    color='primary'
                                                    onClick={handleSendMessage}
                                                    disabled={!messageInput.trim() && !selectedFile}
                                                >
                                                    <IconSend />
                                                </IconButton>
                                            </>
                                        )}
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
