import { useEffect, useState } from 'react'
import {
    Box,
    Card,
    CardContent,
    Grid,
    Stack,
    Typography,
    TextField,
    MenuItem,
    Button,
    Divider,
    Alert,
    Tabs,
    Tab,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Tooltip,
    IconButton,
    Chip,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    CircularProgress
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { IconCopy, IconCheck, IconPlus, IconTrash } from '@tabler/icons-react'

// project imports
import ViewHeader from '@/layout/MainLayout/ViewHeader'
import apiKeyApi from '@/api/apikey'
import useApi from '@/hooks/useApi'

const WhatsAppEndpoint = () => {
    const theme = useTheme()

    // API Key states
    const [apiKeys, setApiKeys] = useState([])
    const [selectedApiKey, setSelectedApiKey] = useState('')
    const [selectedKeyId, setSelectedKeyId] = useState('')
    const [copied, setCopied] = useState(false)
    const [tokenCopied, setTokenCopied] = useState(false)

    // Token creation dialog states
    const [newTokenDialogOpen, setNewTokenDialogOpen] = useState(false)
    const [newTokenLabel, setNewTokenLabel] = useState('')
    const [isCreatingKey, setIsCreatingKey] = useState(false)
    const [newlyCreatedKey, setNewlyCreatedKey] = useState('')
    const [showCopyDialog, setShowCopyDialog] = useState(false)

    // Form inputs for live preview
    const [messageType, setMessageType] = useState('text')
    const [fromPhone, setFromPhone] = useState('201012345678')
    const [toPhone, setToPhone] = useState('201098765432')
    const [textMsg, setTextMsg] = useState('Hello from the WhatsApp API!')
    const [mediaUrl, setMediaUrl] = useState('https://example.com/file.pdf')
    const [caption, setCaption] = useState('Check this out')
    const [latitude, setLatitude] = useState(30.0444)
    const [longitude, setLongitude] = useState(31.2357)
    const [locTitle, setLocTitle] = useState('Cairo, Egypt')

    // Code examples tab
    const [codeTab, setCodeTab] = useState(0)

    const getAllAPIKeysApi = useApi(apiKeyApi.getAllAPIKeys)

    const fetchKeys = () => {
        getAllAPIKeysApi.request()
    }

    useEffect(() => {
        fetchKeys()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        if (getAllAPIKeysApi.data) {
            setApiKeys(getAllAPIKeysApi.data)
            if (getAllAPIKeysApi.data.length > 0) {
                // If there's an existing selection, keep it, otherwise set first
                const currentExists = getAllAPIKeysApi.data.find((k) => k.apiKey === selectedApiKey)
                if (!currentExists) {
                    setSelectedApiKey(getAllAPIKeysApi.data[0].apiKey)
                    setSelectedKeyId(getAllAPIKeysApi.data[0].id)
                }
            } else {
                setSelectedApiKey('')
                setSelectedKeyId('')
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [getAllAPIKeysApi.data])

    const endpointUrl = `${window.location.origin}/api/v1/whatsapp/rest/send_message`

    const handleCopy = (text) => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    const handleCopyTokenOnly = (text) => {
        navigator.clipboard.writeText(text)
        setTokenCopied(true)
        setTimeout(() => setTokenCopied(false), 2000)
    }

    const handleCreateToken = async () => {
        if (!newTokenLabel.trim()) return
        setIsCreatingKey(true)
        try {
            const res = await apiKeyApi.createNewAPI({
                keyName: newTokenLabel,
                permissions: []
            })
            if (res.data) {
                setNewlyCreatedKey(res.data.apiKey)
                setNewTokenDialogOpen(false)
                setNewTokenLabel('')
                setShowCopyDialog(true)
                // Select the new key
                setSelectedApiKey(res.data.apiKey)
                setSelectedKeyId(res.data.id)
                fetchKeys()
            }
        } catch (e) {
            console.error('Failed to create new token:', e)
        } finally {
            setIsCreatingKey(false)
        }
    }

    const handleDeleteToken = async () => {
        if (!selectedKeyId) return
        if (window.confirm('Are you sure you want to revoke/delete this WhatsApp API token?')) {
            try {
                await apiKeyApi.deleteAPI(selectedKeyId)
                setSelectedApiKey('')
                setSelectedKeyId('')
                fetchKeys()
            } catch (e) {
                console.error('Failed to delete token:', e)
            }
        }
    }

    const handleSelectKeyChange = (apiKeyVal) => {
        setSelectedApiKey(apiKeyVal)
        const matched = apiKeys.find((k) => k.apiKey === apiKeyVal)
        if (matched) {
            setSelectedKeyId(matched.id)
        }
    }

    // Generate Request Body dynamically
    const getRequestBody = () => {
        const body = {
            messageType,
            from: fromPhone,
            to: toPhone
        }
        if (messageType === 'text') {
            body.text = textMsg
        } else if (messageType === 'image') {
            body.imageUrl = mediaUrl || 'https://example.com/image.jpg'
            if (caption) body.caption = caption
        } else if (messageType === 'video') {
            body.videoUrl = mediaUrl || 'https://example.com/video.mp4'
            if (caption) body.caption = caption
        } else if (messageType === 'audio') {
            body.aacUrl = mediaUrl || 'https://example.com/audio.aac'
        } else if (messageType === 'document') {
            body.docUrl = mediaUrl || 'https://example.com/doc.pdf'
            if (caption) body.caption = caption
        } else if (messageType === 'location') {
            body.lat = Number(latitude)
            body.long = Number(longitude)
            if (locTitle) body.title = locTitle
        }
        return body
    }

    const getCurlCode = () => {
        const body = getRequestBody()
        return `curl -X POST ${endpointUrl} \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${selectedApiKey || 'YOUR_API_TOKEN'}" \\
  -d '${JSON.stringify(body, null, 4)}'`
    }

    const getJSCode = () => {
        const body = getRequestBody()
        return `fetch("${endpointUrl}", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer ${selectedApiKey || 'YOUR_API_TOKEN'}"
  },
  body: JSON.stringify(${JSON.stringify(body, null, 4)})
})
.then(res => res.json())
.then(data => console.log(data))
.catch(err => console.error(err));`
    }

    const getPythonCode = () => {
        const body = getRequestBody()
        return `import requests
import json

url = "${endpointUrl}"
headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer ${selectedApiKey || 'YOUR_API_TOKEN'}"
}
data = ${JSON.stringify(body, null, 4)}

response = requests.post(url, headers=headers, data=json.dumps(data))
print(response.json())`
    }

    return (
        <Box sx={{ p: 3 }}>
            <Stack direction='row' alignItems='center' justifyContent='space-between' sx={{ mb: 3 }}>
                <ViewHeader title='REST API Endpoint' description='Send WhatsApp messages programmatically from any platform or language' />
                <Button
                    variant='contained'
                    color='primary'
                    startIcon={<IconPlus />}
                    onClick={() => setNewTokenDialogOpen(true)}
                    sx={{ borderRadius: 2 }}
                >
                    Generate New Token (إنشاء توكين جديد)
                </Button>
            </Stack>

            <Grid container spacing={3}>
                {/* Inputs & Parameters */}
                <Grid item xs={12} md={5}>
                    <Card variant='outlined' sx={{ borderRadius: 3, border: '1px solid', borderColor: theme.palette.grey[900] + 15 }}>
                        <CardContent>
                            <Typography variant='h5' sx={{ mb: 2, fontWeight: 'bold' }}>
                                ⚙️ Request Configurator
                            </Typography>

                            <Stack spacing={2.5}>
                                {/* Token Selector with Inline CRUD */}
                                {apiKeys.length === 0 ? (
                                    <Alert severity='warning' sx={{ borderRadius: 2 }}>
                                        No API Tokens found in this workspace. Please click &quot;Generate New Token&quot; above to get
                                        started.
                                    </Alert>
                                ) : (
                                    <Stack direction='row' spacing={1} alignItems='center'>
                                        <TextField
                                            select
                                            fullWidth
                                            label='Select API Key'
                                            value={selectedApiKey}
                                            onChange={(e) => handleSelectKeyChange(e.target.value)}
                                            helperText='Active Token used in code snippets'
                                        >
                                            {apiKeys.map((key) => (
                                                <MenuItem key={key.id} value={key.apiKey}>
                                                    {key.keyName} ({key.apiKey.substring(0, 8)}...)
                                                </MenuItem>
                                            ))}
                                        </TextField>
                                        {selectedKeyId && (
                                            <Tooltip title='Delete/Revoke Selected Token'>
                                                <IconButton onClick={handleDeleteToken} color='error' sx={{ mt: -2 }}>
                                                    <IconTrash size={20} />
                                                </IconButton>
                                            </Tooltip>
                                        )}
                                    </Stack>
                                )}

                                <TextField
                                    fullWidth
                                    label='Sender Phone Number (from)'
                                    value={fromPhone}
                                    onChange={(e) => setFromPhone(e.target.value)}
                                    placeholder='e.g. 201012345678'
                                    helperText='Sender number with country code (connected in WA Devices)'
                                />

                                <TextField
                                    fullWidth
                                    label='Recipient Phone Number (to)'
                                    value={toPhone}
                                    onChange={(e) => setToPhone(e.target.value)}
                                    placeholder='e.g. 201098765432'
                                    helperText='Recipient phone (or WhatsApp group JID ending with @g.us)'
                                />

                                <TextField
                                    select
                                    fullWidth
                                    label='Message Type'
                                    value={messageType}
                                    onChange={(e) => setMessageType(e.target.value)}
                                >
                                    <MenuItem value='text'>text</MenuItem>
                                    <MenuItem value='image'>image</MenuItem>
                                    <MenuItem value='video'>video</MenuItem>
                                    <MenuItem value='audio'>audio</MenuItem>
                                    <MenuItem value='document'>document</MenuItem>
                                    <MenuItem value='location'>location</MenuItem>
                                </TextField>

                                <Divider />

                                {/* Conditional inputs based on messageType */}
                                {messageType === 'text' && (
                                    <TextField
                                        fullWidth
                                        multiline
                                        rows={4}
                                        label='Text Message'
                                        value={textMsg}
                                        onChange={(e) => setTextMsg(e.target.value)}
                                    />
                                )}

                                {(messageType === 'image' ||
                                    messageType === 'video' ||
                                    messageType === 'audio' ||
                                    messageType === 'document') && (
                                    <Stack spacing={2}>
                                        <TextField
                                            fullWidth
                                            label={`${messageType.charAt(0).toUpperCase() + messageType.slice(1)} URL`}
                                            value={mediaUrl}
                                            onChange={(e) => setMediaUrl(e.target.value)}
                                            placeholder={`https://example.com/file.${
                                                messageType === 'document'
                                                    ? 'pdf'
                                                    : messageType === 'video'
                                                    ? 'mp4'
                                                    : messageType === 'audio'
                                                    ? 'aac'
                                                    : 'jpg'
                                            }`}
                                        />
                                        {messageType !== 'audio' && (
                                            <TextField
                                                fullWidth
                                                label='Caption (optional)'
                                                value={caption}
                                                onChange={(e) => setCaption(e.target.value)}
                                            />
                                        )}
                                    </Stack>
                                )}

                                {messageType === 'location' && (
                                    <Stack spacing={2}>
                                        <Grid container spacing={2}>
                                            <Grid item xs={6}>
                                                <TextField
                                                    fullWidth
                                                    type='number'
                                                    label='Latitude'
                                                    value={latitude}
                                                    onChange={(e) => setLatitude(e.target.value)}
                                                />
                                            </Grid>
                                            <Grid item xs={6}>
                                                <TextField
                                                    fullWidth
                                                    type='number'
                                                    label='Longitude'
                                                    value={longitude}
                                                    onChange={(e) => setLongitude(e.target.value)}
                                                />
                                            </Grid>
                                        </Grid>
                                        <TextField
                                            fullWidth
                                            label='Location Title'
                                            value={locTitle}
                                            onChange={(e) => setLocTitle(e.target.value)}
                                        />
                                    </Stack>
                                )}
                            </Stack>
                        </CardContent>
                    </Card>
                </Grid>

                {/* API Docs & Code Previews */}
                <Grid item xs={12} md={7}>
                    <Card
                        variant='outlined'
                        sx={{ borderRadius: 3, border: '1px solid', borderColor: theme.palette.grey[900] + 15, mb: 3 }}
                    >
                        <CardContent>
                            <Typography variant='h5' sx={{ mb: 1, fontWeight: 'bold' }}>
                                🔗 API Endpoint Details
                            </Typography>

                            <Paper
                                variant='outlined'
                                sx={{
                                    p: 1.5,
                                    borderRadius: 2,
                                    bgcolor: theme.palette.grey[50],
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    mb: 2.5
                                }}
                            >
                                <Stack direction='row' spacing={1} alignItems='center'>
                                    <Chip label='POST' color='primary' size='small' sx={{ fontWeight: 'bold', borderRadius: 1.5 }} />
                                    <Typography variant='body1' sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                                        {endpointUrl}
                                    </Typography>
                                </Stack>
                                <Tooltip title={copied ? 'Copied!' : 'Copy Url'}>
                                    <IconButton onClick={() => handleCopy(endpointUrl)} color='primary' size='small'>
                                        {copied ? <IconCheck size={18} /> : <IconCopy size={18} />}
                                    </IconButton>
                                </Tooltip>
                            </Paper>

                            <Typography variant='h5' sx={{ mb: 2, fontWeight: 'bold' }}>
                                💻 Code Example (أمثلة برمجية للاستدعاء)
                            </Typography>

                            <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 1.5 }}>
                                <Tabs value={codeTab} onChange={(e, val) => setCodeTab(val)}>
                                    <Tab label='cURL' />
                                    <Tab label='JavaScript' />
                                    <Tab label='Python' />
                                </Tabs>
                            </Box>

                            <Paper
                                variant='outlined'
                                sx={{
                                    p: 2,
                                    borderRadius: 3,
                                    bgcolor: '#1e1e1e',
                                    color: '#d4d4d4',
                                    fontFamily: 'Consolas, Monaco, monospace',
                                    fontSize: '0.875rem',
                                    whiteSpace: 'pre-wrap',
                                    overflowX: 'auto',
                                    position: 'relative',
                                    minHeight: 180
                                }}
                            >
                                <Box sx={{ position: 'absolute', top: 8, right: 8 }}>
                                    <Tooltip title='Copy Code'>
                                        <IconButton
                                            onClick={() =>
                                                handleCopy(codeTab === 0 ? getCurlCode() : codeTab === 1 ? getJSCode() : getPythonCode())
                                            }
                                            sx={{ color: '#d4d4d4', '&:hover': { bgcolor: 'rgba(255,255,255,0.1)' } }}
                                        >
                                            <IconCopy size={18} />
                                        </IconButton>
                                    </Tooltip>
                                </Box>
                                <code>
                                    {codeTab === 0 && getCurlCode()}
                                    {codeTab === 1 && getJSCode()}
                                    {codeTab === 2 && getPythonCode()}
                                </code>
                            </Paper>
                        </CardContent>
                    </Card>

                    {/* Parameters Documentation Table */}
                    <Typography variant='h4' sx={{ mb: 1.5, fontWeight: 'bold' }}>
                        📋 API Parameters Table
                    </Typography>

                    <TableContainer component={Paper} variant='outlined' sx={{ borderRadius: 3 }}>
                        <Table size='small'>
                            <TableHead sx={{ bgcolor: theme.palette.grey[50] }}>
                                <TableRow>
                                    <TableCell sx={{ fontWeight: 'bold' }}>PARAMETER</TableCell>
                                    <TableCell sx={{ fontWeight: 'bold' }}>TYPE</TableCell>
                                    <TableCell sx={{ fontWeight: 'bold' }}>REQUIRED</TableCell>
                                    <TableCell sx={{ fontWeight: 'bold' }}>DESCRIPTION</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                <TableRow>
                                    <TableCell sx={{ fontFamily: 'monospace' }}>messageType</TableCell>
                                    <TableCell>string</TableCell>
                                    <TableCell>Yes</TableCell>
                                    <TableCell>text | image | video | audio | document | location</TableCell>
                                </TableRow>
                                <TableRow>
                                    <TableCell sx={{ fontFamily: 'monospace' }}>token</TableCell>
                                    <TableCell>string</TableCell>
                                    <TableCell>Yes</TableCell>
                                    <TableCell>Authentication key (can also pass in Bearer header)</TableCell>
                                </TableRow>
                                <TableRow>
                                    <TableCell sx={{ fontFamily: 'monospace' }}>from</TableCell>
                                    <TableCell>string</TableCell>
                                    <TableCell>Yes</TableCell>
                                    <TableCell>Sender phone number registered in WA Devices</TableCell>
                                </TableRow>
                                <TableRow>
                                    <TableCell sx={{ fontFamily: 'monospace' }}>to</TableCell>
                                    <TableCell>string</TableCell>
                                    <TableCell>Yes</TableCell>
                                    <TableCell>Recipient phone number or group JID</TableCell>
                                </TableRow>
                                <TableRow>
                                    <TableCell sx={{ fontFamily: 'monospace' }}>text</TableCell>
                                    <TableCell>string</TableCell>
                                    <TableCell>Conditional</TableCell>
                                    <TableCell>Required if messageType is &quot;text&quot;</TableCell>
                                </TableRow>
                                <TableRow>
                                    <TableCell sx={{ fontFamily: 'monospace' }}>imageUrl / videoUrl / aacUrl / docUrl</TableCell>
                                    <TableCell>string (URL)</TableCell>
                                    <TableCell>Conditional</TableCell>
                                    <TableCell>Required for corresponding media messageTypes</TableCell>
                                </TableRow>
                                <TableRow>
                                    <TableCell sx={{ fontFamily: 'monospace' }}>lat / long</TableCell>
                                    <TableCell>number</TableCell>
                                    <TableCell>Conditional</TableCell>
                                    <TableCell>Required for &quot;location&quot; messageType</TableCell>
                                </TableRow>
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Grid>
            </Grid>

            {/* Dialog to create token */}
            <Dialog open={newTokenDialogOpen} onClose={() => setNewTokenDialogOpen(false)} fullWidth maxWidth='xs'>
                <DialogTitle sx={{ fontWeight: 'bold' }}>Generate New API Token</DialogTitle>
                <DialogContent>
                    <Typography variant='body2' color='textSecondary' sx={{ mb: 2 }}>
                        Give your token a descriptive name so you remember where it is used.
                    </Typography>
                    <TextField
                        fullWidth
                        label='Token Name'
                        value={newTokenLabel}
                        onChange={(e) => setNewTokenLabel(e.target.value)}
                        placeholder='e.g. WhatsApp Marketing Server'
                        disabled={isCreatingKey}
                    />
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 3 }}>
                    <Button onClick={() => setNewTokenDialogOpen(false)} color='inherit' disabled={isCreatingKey}>
                        Cancel
                    </Button>
                    <Button
                        variant='contained'
                        onClick={handleCreateToken}
                        disabled={isCreatingKey || !newTokenLabel.trim()}
                        startIcon={isCreatingKey ? <CircularProgress size={14} color='inherit' /> : null}
                    >
                        Create Token
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Dialog to display and copy raw new token */}
            <Dialog open={showCopyDialog} onClose={() => setShowCopyDialog(false)} fullWidth maxWidth='sm'>
                <DialogTitle sx={{ fontWeight: 'bold' }}>Token Created Successfully 🎉</DialogTitle>
                <DialogContent>
                    <Alert severity='warning' sx={{ mb: 2, borderRadius: 2 }}>
                        Please copy your token now. For security reasons, <b>you will not be able to see it again</b> after closing this
                        window.
                    </Alert>
                    <Paper
                        variant='outlined'
                        sx={{
                            p: 2,
                            borderRadius: 2,
                            bgcolor: theme.palette.grey[50],
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            border: '1px dashed',
                            borderColor: theme.palette.primary.main
                        }}
                    >
                        <Typography variant='body1' sx={{ fontFamily: 'monospace', wordBreak: 'break-all', fontWeight: 'bold' }}>
                            {newlyCreatedKey}
                        </Typography>
                        <Tooltip title={tokenCopied ? 'Copied!' : 'Copy Token'}>
                            <IconButton onClick={() => handleCopyTokenOnly(newlyCreatedKey)} color='primary'>
                                {tokenCopied ? <IconCheck /> : <IconCopy />}
                            </IconButton>
                        </Tooltip>
                    </Paper>
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 3 }}>
                    <Button variant='contained' onClick={() => setShowCopyDialog(false)}>
                        Done
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    )
}

export default WhatsAppEndpoint
