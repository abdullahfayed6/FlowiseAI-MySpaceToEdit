import { useState, useEffect, useRef } from 'react'
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
    CircularProgress,
    Paper,
    Tabs,
    Tab,
    LinearProgress
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { IconCheck, IconX, IconUpload, IconDownload, IconPlayerPlay, IconPlayerStop } from '@tabler/icons-react'

// project imports
import ViewHeader from '@/layout/MainLayout/ViewHeader'
import whatsappApi from '@/api/whatsapp'

const WhatsAppValidator = () => {
    const theme = useTheme()

    // Connected devices states
    const [devices, setDevices] = useState([])
    const [devicesLoading, setDevicesLoading] = useState(true)
    const [selectedDeviceId, setSelectedDeviceId] = useState('')

    // Input method tab: 0 = Paste, 1 = Upload File
    const [inputTab, setInputTab] = useState(0)
    const [rawNumbersText, setRawNumbersText] = useState('')
    const [fileName, setFileName] = useState('')
    const [fileNumbers, setFileNumbers] = useState([])

    // Validation process states
    const [isProcessing, setIsProcessing] = useState(false)
    const [progress, setProgress] = useState(0) // percentage
    const [totalCount, setTotalCount] = useState(0)
    const [checkedCount, setCheckedCount] = useState(0)
    const [validNumbers, setValidNumbers] = useState([])
    const [invalidNumbers, setInvalidNumbers] = useState([])

    // Timer states
    const [elapsedTime, setElapsedTime] = useState(0) // seconds
    const timerRef = useRef(null)
    const stopRequestRef = useRef(false)

    // Fetch devices on mount
    useEffect(() => {
        const fetchDevices = async () => {
            try {
                setDevicesLoading(true)
                const res = await whatsappApi.getDevices()
                if (res && res.data) {
                    const connected = res.data.filter((d) => d.status === 'CONNECTED')
                    setDevices(connected)
                    if (connected.length > 0) {
                        setSelectedDeviceId(connected[0].id)
                    }
                }
            } catch (e) {
                console.error('Error fetching WhatsApp devices:', e)
            } finally {
                setDevicesLoading(false)
            }
        }
        fetchDevices()
    }, [])

    // Timer logic
    useEffect(() => {
        if (isProcessing) {
            timerRef.current = setInterval(() => {
                setElapsedTime((prev) => prev + 1)
            }, 1000)
        } else {
            if (timerRef.current) {
                clearInterval(timerRef.current)
                timerRef.current = null
            }
        }
        return () => {
            if (timerRef.current) clearInterval(timerRef.current)
        }
    }, [isProcessing])

    const handleFileChange = (e) => {
        if (e.target.files && e.target.files.length > 0) {
            const file = e.target.files[0]
            setFileName(file.name)

            const reader = new FileReader()
            reader.onload = (event) => {
                const text = event.target.result || ''
                // Split by comma, semi-colon or newline
                const parsed = text
                    .split(/[\n,;]+/)
                    .map((num) => num.trim())
                    .filter((num) => num.length > 0)
                setFileNumbers(parsed)
            }
            reader.readAsText(file)
        }
    }

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60)
        const secs = seconds % 60
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }

    // Process numbers in chunks of 50 to have responsive progress updates and prevent socket timeouts
    const startValidation = async () => {
        // Parse numbers to process
        let numbersList = []
        if (inputTab === 0) {
            numbersList = rawNumbersText
                .split(/[\n,;]+/)
                .map((num) => num.trim())
                .filter((num) => num.length > 0)
        } else {
            numbersList = [...fileNumbers]
        }

        if (numbersList.length === 0) {
            alert('Please provide some phone numbers to validate.')
            return
        }
        if (!selectedDeviceId) {
            alert('Please select a connected WhatsApp device.')
            return
        }

        // Reset states
        setIsProcessing(true)
        setElapsedTime(0)
        setProgress(0)
        setTotalCount(numbersList.length)
        setCheckedCount(0)
        setValidNumbers([])
        setInvalidNumbers([])
        stopRequestRef.current = false

        const chunkSize = 20 // Send 20 numbers at a time to the backend filterNumbers endpoint
        let validTemp = []
        let invalidTemp = []

        for (let i = 0; i < numbersList.length; i += chunkSize) {
            if (stopRequestRef.current) {
                break
            }

            const chunk = numbersList.slice(i, i + chunkSize)
            try {
                const response = await whatsappApi.filterNumbers(selectedDeviceId, chunk)
                if (response && response.data) {
                    const chunkValid = response.data.valid || []
                    const chunkInvalid = response.data.invalid || []

                    validTemp = [...validTemp, ...chunkValid]
                    invalidTemp = [...invalidTemp, ...chunkInvalid]

                    setValidNumbers([...validTemp])
                    setInvalidNumbers([...invalidTemp])
                }
            } catch (err) {
                console.error('Failed to validate chunk:', err)
                // Treat this chunk as invalid if request fails
                invalidTemp = [...invalidTemp, ...chunk]
                setInvalidNumbers([...invalidTemp])
            }

            const checked = Math.min(i + chunkSize, numbersList.length)
            setCheckedCount(checked)
            setProgress(Math.round((checked / numbersList.length) * 100))
        }

        setIsProcessing(false)
    }

    const stopValidation = () => {
        stopRequestRef.current = true
        setIsProcessing(false)
    }

    const downloadValidNumbers = () => {
        if (validNumbers.length === 0) return

        // Create a text blob with valid numbers, one per line
        const blobContent = validNumbers.join('\n')
        const blob = new Blob([blobContent], { type: 'text/plain;charset=utf-8' })
        const url = URL.createObjectURL(blob)

        const link = document.createElement('a')
        link.href = url
        link.setAttribute('download', `valid_whatsapp_numbers_${Date.now()}.txt`)
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
    }

    return (
        <Box sx={{ p: 3 }}>
            <ViewHeader title='WhatsApp Validator' description='Verify which numbers in your list are registered on WhatsApp' />

            <Grid container spacing={3} sx={{ mt: 1 }}>
                {/* Configuration Panel */}
                <Grid item xs={12} md={6}>
                    <Card variant='outlined' sx={{ borderRadius: 3, border: '1px solid', borderColor: theme.palette.grey[900] + 15 }}>
                        <CardContent>
                            <Typography variant='h5' sx={{ mb: 2, fontWeight: 'bold' }}>
                                Validator Settings
                            </Typography>

                            <Stack spacing={2.5}>
                                {/* Device select */}
                                {devicesLoading ? (
                                    <CircularProgress size={20} />
                                ) : devices.length === 0 ? (
                                    <Alert severity='error' sx={{ borderRadius: 2 }}>
                                        No connected WhatsApp devices found. Please connect a device in the WhatsApp Devices section first.
                                    </Alert>
                                ) : (
                                    <TextField
                                        select
                                        fullWidth
                                        label='Select WhatsApp Device'
                                        value={selectedDeviceId}
                                        onChange={(e) => setSelectedDeviceId(e.target.value)}
                                        disabled={isProcessing}
                                        helperText='Select device to execute server-side onWhatsApp checks'
                                    >
                                        {devices.map((dev) => (
                                            <MenuItem key={dev.id} value={dev.id}>
                                                {dev.name} ({dev.phoneNumber})
                                            </MenuItem>
                                        ))}
                                    </TextField>
                                )}

                                {/* Input tabs */}
                                <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                                    <Tabs value={inputTab} onChange={(e, val) => setInputTab(val)} disabled={isProcessing}>
                                        <Tab label='Paste Numbers' />
                                        <Tab label='Upload File' />
                                    </Tabs>
                                </Box>

                                {inputTab === 0 ? (
                                    <TextField
                                        fullWidth
                                        multiline
                                        rows={8}
                                        label='Phone Numbers list'
                                        value={rawNumbersText}
                                        onChange={(e) => setRawNumbersText(e.target.value)}
                                        disabled={isProcessing}
                                        placeholder='Enter numbers (e.g. 201012345678, 201123456789), one per line or comma-separated'
                                    />
                                ) : (
                                    <Paper
                                        variant='outlined'
                                        sx={{
                                            p: 3,
                                            textAlign: 'center',
                                            borderRadius: 2,
                                            borderStyle: 'dashed',
                                            borderColor: theme.palette.grey[400],
                                            cursor: isProcessing ? 'default' : 'pointer',
                                            '&:hover': {
                                                borderColor: isProcessing ? theme.palette.grey[400] : theme.palette.primary.main
                                            }
                                        }}
                                        component='label'
                                    >
                                        <input
                                            type='file'
                                            accept='.csv,.txt'
                                            style={{ display: 'none' }}
                                            onChange={handleFileChange}
                                            disabled={isProcessing}
                                        />
                                        <IconUpload size={32} color={theme.palette.text.secondary} />
                                        <Typography variant='body1' sx={{ mt: 1, fontWeight: 'medium' }}>
                                            {fileName ? `Selected file: ${fileName}` : 'Click to select CSV or TXT file'}
                                        </Typography>
                                        <Typography variant='caption' color='textSecondary' display='block' sx={{ mt: 0.5 }}>
                                            Supported extensions: .csv, .txt (one phone number per row/line)
                                        </Typography>
                                        {fileNumbers.length > 0 && (
                                            <Typography variant='body2' color='success.main' sx={{ mt: 1.5, fontWeight: 'bold' }}>
                                                Loaded {fileNumbers.length} numbers successfully
                                            </Typography>
                                        )}
                                    </Paper>
                                )}

                                <Divider sx={{ my: 1 }} />

                                {/* Control Buttons */}
                                <Stack direction='row' spacing={2}>
                                    {!isProcessing ? (
                                        <Button
                                            variant='contained'
                                            color='primary'
                                            fullWidth
                                            size='large'
                                            onClick={startValidation}
                                            disabled={
                                                !selectedDeviceId || (inputTab === 0 ? !rawNumbersText.trim() : fileNumbers.length === 0)
                                            }
                                            startIcon={<IconPlayerPlay />}
                                            sx={{ borderRadius: 2 }}
                                        >
                                            Start Validation
                                        </Button>
                                    ) : (
                                        <Button
                                            variant='contained'
                                            color='error'
                                            fullWidth
                                            size='large'
                                            onClick={stopValidation}
                                            startIcon={<IconPlayerStop />}
                                            sx={{ borderRadius: 2 }}
                                        >
                                            Stop Process
                                        </Button>
                                    )}
                                </Stack>
                            </Stack>
                        </CardContent>
                    </Card>
                </Grid>

                {/* Progress & Live Statistics */}
                <Grid item xs={12} md={6}>
                    <Card
                        variant='outlined'
                        sx={{
                            borderRadius: 3,
                            border: '1px solid',
                            borderColor: theme.palette.grey[900] + 15,
                            height: '100%',
                            position: 'relative'
                        }}
                    >
                        <CardContent>
                            {/* Running Timer in top right corner */}
                            <Box sx={{ position: 'absolute', top: 16, right: 16, display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography
                                    variant='h5'
                                    sx={{
                                        fontFamily: 'monospace',
                                        fontWeight: 'bold',
                                        color: isProcessing ? 'primary.main' : 'text.secondary',
                                        bgcolor: theme.palette.grey[100],
                                        px: 1.5,
                                        py: 0.5,
                                        borderRadius: 2
                                    }}
                                >
                                    Duration: {formatTime(elapsedTime)}
                                </Typography>
                            </Box>

                            <Typography variant='h5' sx={{ mb: 4, fontWeight: 'bold' }}>
                                Progress Details
                            </Typography>

                            {/* Progress bar */}
                            <Stack spacing={1} sx={{ mb: 4 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <Typography variant='body2' color='textSecondary'>
                                        Checked: {checkedCount} / {totalCount}
                                    </Typography>
                                    <Typography variant='body2' sx={{ fontWeight: 'bold' }}>
                                        {progress}%
                                    </Typography>
                                </Box>
                                <LinearProgress variant='determinate' value={progress} sx={{ height: 10, borderRadius: 5 }} />
                            </Stack>

                            {/* Status counts widgets */}
                            <Grid container spacing={2} sx={{ mb: 4 }}>
                                <Grid item xs={6}>
                                    <Paper variant='outlined' sx={{ p: 2, textAlign: 'center', borderRadius: 3, bgcolor: '#e8f5e9' }}>
                                        <Typography variant='caption' color='textSecondary' display='block' sx={{ mb: 0.5 }}>
                                            Valid WhatsApp Numbers
                                        </Typography>
                                        <Stack direction='row' spacing={1} justifyContent='center' alignItems='center'>
                                            <IconCheck color={theme.palette.success.main} />
                                            <Typography variant='h2' color='success.main' sx={{ fontWeight: 'bold' }}>
                                                {validNumbers.length}
                                            </Typography>
                                        </Stack>
                                    </Paper>
                                </Grid>
                                <Grid item xs={6}>
                                    <Paper variant='outlined' sx={{ p: 2, textAlign: 'center', borderRadius: 3, bgcolor: '#ffebee' }}>
                                        <Typography variant='caption' color='textSecondary' display='block' sx={{ mb: 0.5 }}>
                                            Invalid / Non-WhatsApp
                                        </Typography>
                                        <Stack direction='row' spacing={1} justifyContent='center' alignItems='center'>
                                            <IconX color={theme.palette.error.main} />
                                            <Typography variant='h2' color='error.main' sx={{ fontWeight: 'bold' }}>
                                                {invalidNumbers.length}
                                            </Typography>
                                        </Stack>
                                    </Paper>
                                </Grid>
                            </Grid>

                            <Divider sx={{ mb: 3 }} />

                            {/* Download Button */}
                            <Button
                                variant='contained'
                                color='secondary'
                                fullWidth
                                size='large'
                                onClick={downloadValidNumbers}
                                disabled={validNumbers.length === 0 || isProcessing}
                                startIcon={<IconDownload />}
                                sx={{ borderRadius: 3 }}
                            >
                                Download Valid Numbers
                            </Button>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>
        </Box>
    )
}

export default WhatsAppValidator
