'use client'

import { useEffect, useState, useRef, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { db } from '@/lib/firebase'
import { collection, getDocs, doc, getDoc } from 'firebase/firestore'
import { Event } from '../events/page'
import Link from 'next/link'
import {
    Sparkles,
    ImagePlus,
    Loader2,
    CheckCircle2,
    XCircle,
    ArrowRight,
    Link2,
    ChevronDown,
    Upload,
    X,
} from 'lucide-react'

type ImportState = 'idle' | 'loading' | 'importing' | 'done' | 'error'
type ImportTab = 'google' | 'upload'
type AnalysisState = 'idle' | 'analyzing' | 'done' | 'error'

type ProgressLine = {
    type: 'status' | 'progress' | 'complete' | 'error'
    message?: string
    imported?: number
    failed?: number
    current?: number
    total?: number
    fileName?: string
    error?: string
}

function ImportPageInner() {
    const searchParams = useSearchParams()
    const [albumUrl, setAlbumUrl] = useState('')
    const [events, setEvents] = useState<Event[]>([])
    const [selectedEventId, setSelectedEventId] = useState('')
    const [state, setState] = useState<ImportState>('idle')
    const [statusMessage, setStatusMessage] = useState('')
    const [progress, setProgress] = useState({ imported: 0, failed: 0, current: 0, total: 0 })
    const [errorMessage, setErrorMessage] = useState('')
    const [analysisState, setAnalysisState] = useState<AnalysisState>('idle')
    const [analysisMessage, setAnalysisMessage] = useState('')
    const abortRef = useRef<AbortController | null>(null)
    const [activeTab, setActiveTab] = useState<ImportTab>('upload')

    // Upload-specific state
    const [selectedFiles, setSelectedFiles] = useState<File[]>([])
    const [isDragging, setIsDragging] = useState(false)
    const fileInputRef = useRef<HTMLInputElement | null>(null)

    // Fetch events on mount & auto-select from URL param
    useEffect(() => {
        const fetchEvents = async () => {
            try {
                const snap = await getDocs(collection(db, 'events'));
                const allEvents: Event[] = [];
                snap.forEach(d => allEvents.push({ id: d.id, ...d.data() } as Event));

                const data = allEvents
                    .filter(e => e.is_public !== false)
                    .sort((a, b) => {
                        const dateA = new Date(a.created_at || 0).getTime()
                        const dateB = new Date(b.created_at || 0).getTime()
                        return dateB - dateA
                    });

                const preselect = searchParams.get('eventId')

                if (preselect && !data.some(e => e.id === preselect)) {
                    try {
                        const eventDoc = await getDoc(doc(db, 'events', preselect));
                        if (eventDoc.exists()) {
                            data.unshift({ id: eventDoc.id, ...eventDoc.data() } as Event);
                        }
                    } catch (e) {
                        console.warn('Could not fetch event by ID:', e);
                    }
                }

                setEvents(data)
                if (preselect && data.some(e => e.id === preselect)) {
                    setSelectedEventId(preselect)
                }
            } catch (err) {
                console.error("Error fetching events:", err);
            }
        }
        fetchEvents()
    }, [searchParams])

    const runAiAnalysis = useCallback(async (eventId: string) => {
        setAnalysisState('analyzing')
        setAnalysisMessage('Running AI image analysis…')

        try {
            const response = await fetch('/api/analyze-uploads', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ eventId }),
            })

            const result = await response.json()
            if (!response.ok || result.error) {
                throw new Error(result.error || `Analysis failed: HTTP ${response.status}`)
            }

            setAnalysisState('done')
            setAnalysisMessage(result.message || `Analyzed ${result.analyzed ?? 0} uploads`)
        } catch (err: unknown) {
            setAnalysisState('error')
            setAnalysisMessage(err instanceof Error ? err.message : 'AI analysis failed')
        }
    }, [])

    // ── Google Photos Import ──────────────────────────────────────────────
    const handleGoogleImport = useCallback(async () => {
        if (!albumUrl || !selectedEventId) return

        setState('loading')
        setStatusMessage('Connecting to Google Photos…')
        setProgress({ imported: 0, failed: 0, current: 0, total: 0 })
        setErrorMessage('')
        setAnalysisState('idle')
        setAnalysisMessage('')

        const controller = new AbortController()
        abortRef.current = controller

        try {
            const response = await fetch('/api/import-google-photos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ albumUrl, eventId: selectedEventId }),
                signal: controller.signal,
            })

            if (!response.ok || !response.body) {
                const err = await response.json().catch(() => ({ error: 'Unknown error' }))
                throw new Error(err.error || `HTTP ${response.status}`)
            }

            setState('importing')

            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''
            let isTerminalState = false
            let importedCount = 0

            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                buffer += decoder.decode(value, { stream: true })

                const lines = buffer.split('\n')
                buffer = lines.pop() || ''

                for (const line of lines) {
                    if (!line.trim()) continue
                    try {
                        const data: ProgressLine = JSON.parse(line)

                        if (data.type === 'status') {
                            setStatusMessage(data.message || '')
                            if (data.total) {
                                setProgress(prev => ({ ...prev, total: data.total! }))
                            }
                        } else if (data.type === 'progress') {
                            setProgress({
                                imported: data.imported ?? 0,
                                failed: data.failed ?? 0,
                                current: data.current ?? 0,
                                total: data.total ?? 0,
                            })
                        } else if (data.type === 'complete') {
                            importedCount = data.imported ?? 0
                            setProgress({
                                imported: data.imported ?? 0,
                                failed: data.failed ?? 0,
                                current: data.total ?? 0,
                                total: data.total ?? 0,
                            })
                            setState('done')
                            isTerminalState = true
                        } else if (data.type === 'error') {
                            setErrorMessage(data.message || 'Something went wrong')
                            setState('error')
                            isTerminalState = true
                        }
                    } catch {
                        // skip invalid JSON chunks
                    }
                }
            }

            if (!isTerminalState) {
                setState('done')
            }

            if (importedCount > 0) {
                await runAiAnalysis(selectedEventId)
            }
        } catch (err: unknown) {
            if ((err as Error).name === 'AbortError') {
                setStatusMessage('Import cancelled.')
                setState('idle')
            } else {
                setErrorMessage(err instanceof Error ? err.message : 'Unknown error')
                setState('error')
            }
        }
    }, [albumUrl, selectedEventId, runAiAnalysis])

    // ── Direct File Upload ────────────────────────────────────────────────
    const handleFileUpload = useCallback(async () => {
        if (selectedFiles.length === 0 || !selectedEventId) return

        setState('loading')
        setStatusMessage('Uploading files…')
        setProgress({ imported: 0, failed: 0, current: 0, total: selectedFiles.length })
        setErrorMessage('')
        setAnalysisState('idle')
        setAnalysisMessage('')

        try {
            const formData = new FormData()
            formData.append('eventId', selectedEventId)
            selectedFiles.forEach(file => formData.append('files', file))

            setState('importing')

            const response = await fetch('/api/upload-photos', {
                method: 'POST',
                body: formData,
            })

            const result = await response.json()

            if (!response.ok) {
                throw new Error(result.error || `Upload failed: HTTP ${response.status}`)
            }

            setProgress({
                imported: result.imported ?? 0,
                failed: result.failed ?? 0,
                current: result.total ?? 0,
                total: result.total ?? 0,
            })
            setState('done')
            setSelectedFiles([])

            if ((result.imported ?? 0) > 0) {
                await runAiAnalysis(selectedEventId)
            }
        } catch (err: unknown) {
            setErrorMessage(err instanceof Error ? err.message : 'Upload failed')
            setState('error')
        }
    }, [selectedFiles, selectedEventId, runAiAnalysis])

    // ── Drag & Drop handlers ──────────────────────────────────────────────
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(true)
    }, [])

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)
    }, [])

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)
        const files = Array.from(e.dataTransfer.files).filter(
            f => f.type.startsWith('image/') || f.type.startsWith('video/')
        )
        setSelectedFiles(prev => [...prev, ...files])
    }, [])

    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const files = Array.from(e.target.files).filter(
                f => f.type.startsWith('image/') || f.type.startsWith('video/')
            )
            setSelectedFiles(prev => [...prev, ...files])
        }
    }, [])

    const removeFile = useCallback((index: number) => {
        setSelectedFiles(prev => prev.filter((_, i) => i !== index))
    }, [])

    const progressPercent =
        progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0

    const selectedEvent = events.find(e => e.id === selectedEventId)

    return (
        <div className="min-h-screen bg-black text-white relative flex flex-col">
            {/* Background effects */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-purple-900/10 via-black to-blue-900/10" />
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-purple-600/20 rounded-full mix-blend-screen filter blur-[120px] animate-blob" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-600/20 rounded-full mix-blend-screen filter blur-[120px] animate-blob animation-delay-2000" />
            </div>

            {/* Nav */}
            <nav className="relative z-50 sticky top-0 border-b border-white/5 bg-black/50 backdrop-blur-xl">
                <div className="container mx-auto px-6 py-5 flex items-center justify-between">
                    <Link
                        href="/"
                        className="text-3xl font-extrabold tracking-tighter bg-gradient-to-r from-purple-400 via-pink-500 to-blue-500 bg-clip-text text-transparent drop-shadow-sm flex items-center gap-2"
                    >
                        <Sparkles className="w-6 h-6 text-purple-400" />
                        AURA
                    </Link>
                    <Link
                        href="/events"
                        className="text-sm font-medium text-gray-300 hover:text-white transition-colors"
                    >
                        Browse Events
                    </Link>
                </div>
            </nav>

            {/* Content */}
            <main className="flex-1 relative z-10 flex items-center justify-center px-6 py-20">
                <div className="w-full max-w-2xl">
                    {/* Header */}
                    <div className="text-center mb-12">
                        <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/20 rounded-full mb-6 shadow-lg shadow-purple-500/5">
                            <ImagePlus className="w-4 h-4 text-purple-400" />
                            <span className="text-sm font-medium text-purple-200 tracking-wide uppercase">
                                Add Photos
                            </span>
                        </div>
                        <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
                            Add Photos to{' '}
                            <span className="bg-gradient-to-r from-purple-400 via-pink-500 to-blue-500 bg-clip-text text-transparent">
                                Your Event
                            </span>
                        </h1>
                        <p className="text-lg text-gray-400 max-w-xl mx-auto">
                            Upload files directly or import from a Google Photos shared album.
                        </p>
                    </div>

                    {/* Card */}
                    <div className="glass-panel rounded-3xl p-8 md:p-10 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-40 h-40 bg-purple-500/10 rounded-bl-full blur-2xl pointer-events-none" />

                        {/* ── IDLE / LOADING FORM ─────────────────────────────── */}
                        {(state === 'idle' || state === 'loading') && (
                            <div className="space-y-6 relative z-10">
                                {/* Event Selector (shared) */}
                                <div>
                                    <label className="block text-sm font-medium mb-2 text-gray-300">
                                        Select Event
                                    </label>
                                    <div className="relative">
                                        <select
                                            value={selectedEventId}
                                            onChange={e => setSelectedEventId(e.target.value)}
                                            className="w-full px-5 py-4 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/20 transition text-white appearance-none cursor-pointer text-base"
                                            disabled={state === 'loading'}
                                        >
                                            <option value="" className="bg-gray-900">
                                                Choose an event…
                                            </option>
                                            {events.map(event => (
                                                <option key={event.id} value={event.id} className="bg-gray-900">
                                                    {event.name}
                                                </option>
                                            ))}
                                        </select>
                                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500 pointer-events-none" />
                                    </div>
                                    {events.length === 0 && (
                                        <p className="text-xs text-gray-500 mt-2">
                                            No events found.{' '}
                                            <Link href="/create" className="text-purple-400 hover:text-purple-300">
                                                Create one first
                                            </Link>
                                            .
                                        </p>
                                    )}
                                </div>

                                {analysisState !== 'idle' && (
                                    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-300 flex items-center justify-center gap-2">
                                        {analysisState === 'analyzing' ? (
                                            <>
                                                <Loader2 className="w-4 h-4 animate-spin text-purple-300" />
                                                <span>{analysisMessage}</span>
                                            </>
                                        ) : analysisState === 'done' ? (
                                            <>
                                                <CheckCircle2 className="w-4 h-4 text-green-400" />
                                                <span>{analysisMessage}</span>
                                            </>
                                        ) : (
                                            <>
                                                <XCircle className="w-4 h-4 text-red-400" />
                                                <span>{analysisMessage}</span>
                                            </>
                                        )}
                                    </div>
                                )}

                                {/* Tab Switcher */}
                                <div className="flex bg-white/5 rounded-xl p-1 border border-white/10">
                                    <button
                                        onClick={() => setActiveTab('upload')}
                                        className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold transition-all ${activeTab === 'upload'
                                                ? 'bg-gradient-to-r from-purple-500/20 to-blue-500/20 text-white border border-purple-500/30 shadow-lg shadow-purple-500/10'
                                                : 'text-gray-400 hover:text-gray-200'
                                            }`}
                                    >
                                        <Upload className="w-4 h-4" />
                                        Upload Files
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('google')}
                                        className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold transition-all ${activeTab === 'google'
                                                ? 'bg-gradient-to-r from-purple-500/20 to-blue-500/20 text-white border border-purple-500/30 shadow-lg shadow-purple-500/10'
                                                : 'text-gray-400 hover:text-gray-200'
                                            }`}
                                    >
                                        <Link2 className="w-4 h-4" />
                                        Google Photos
                                    </button>
                                </div>

                                {/* ── Upload Files Tab ─────────────── */}
                                {activeTab === 'upload' && (
                                    <div className="space-y-4">
                                        {/* Drop Zone */}
                                        <div
                                            onDragOver={handleDragOver}
                                            onDragLeave={handleDragLeave}
                                            onDrop={handleDrop}
                                            onClick={() => fileInputRef.current?.click()}
                                            className={`relative border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${isDragging
                                                    ? 'border-purple-500 bg-purple-500/10 scale-[1.02]'
                                                    : 'border-white/10 hover:border-purple-500/40 hover:bg-white/[0.02]'
                                                }`}
                                        >
                                            <input
                                                ref={fileInputRef}
                                                type="file"
                                                multiple
                                                accept="image/*,video/*"
                                                onChange={handleFileSelect}
                                                className="hidden"
                                            />
                                            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/20 flex items-center justify-center">
                                                <Upload className={`w-7 h-7 transition-colors ${isDragging ? 'text-purple-400' : 'text-gray-500'}`} />
                                            </div>
                                            <p className="text-gray-300 font-medium mb-1">
                                                {isDragging ? 'Drop files here' : 'Drag & drop photos here'}
                                            </p>
                                            <p className="text-sm text-gray-500">
                                                or <span className="text-purple-400">click to browse</span> • Images & videos
                                            </p>
                                        </div>

                                        {/* Selected Files Preview */}
                                        {selectedFiles.length > 0 && (
                                            <div className="space-y-2">
                                                <p className="text-sm text-gray-400">
                                                    {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''} selected
                                                    <span className="text-gray-600 ml-2">
                                                        ({(selectedFiles.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(1)} MB)
                                                    </span>
                                                </p>
                                                <div className="max-h-40 overflow-y-auto space-y-1 scrollbar-hide">
                                                    {selectedFiles.map((file, i) => (
                                                        <div
                                                            key={`${file.name}-${i}`}
                                                            className="flex items-center justify-between px-3 py-2 bg-white/5 rounded-lg text-sm"
                                                        >
                                                            <span className="text-gray-300 truncate flex-1 mr-2">
                                                                {file.name}
                                                            </span>
                                                            <span className="text-gray-600 text-xs shrink-0 mr-2">
                                                                {(file.size / 1024 / 1024).toFixed(1)} MB
                                                            </span>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); removeFile(i) }}
                                                                className="text-gray-500 hover:text-red-400 transition shrink-0"
                                                            >
                                                                <X className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Upload Button */}
                                        <button
                                            onClick={handleFileUpload}
                                            disabled={selectedFiles.length === 0 || !selectedEventId || state === 'loading'}
                                            className="w-full py-4 bg-gradient-to-r from-purple-500 to-blue-500 rounded-xl font-bold text-lg hover:from-purple-600 hover:to-blue-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_0_30px_rgba(168,85,247,0.2)] hover:shadow-[0_0_40px_rgba(168,85,247,0.4)] hover:-translate-y-0.5 flex items-center justify-center gap-3"
                                        >
                                            {state === 'loading' ? (
                                                <>
                                                    <Loader2 className="w-5 h-5 animate-spin" />
                                                    Uploading…
                                                </>
                                            ) : (
                                                <>
                                                    <Upload className="w-5 h-5" />
                                                    Upload {selectedFiles.length > 0 ? `${selectedFiles.length} File${selectedFiles.length !== 1 ? 's' : ''}` : 'Files'}
                                                </>
                                            )}
                                        </button>
                                    </div>
                                )}

                                {/* ── Google Photos Tab ─────────────── */}
                                {activeTab === 'google' && (
                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-sm font-medium mb-2 text-gray-300">
                                                <Link2 className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                                                Shareable Album Link
                                            </label>
                                            <input
                                                type="url"
                                                value={albumUrl}
                                                onChange={e => setAlbumUrl(e.target.value)}
                                                placeholder="https://photos.app.goo.gl/... or https://photos.google.com/share/..."
                                                className="w-full px-5 py-4 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/20 transition text-white placeholder:text-gray-600 text-base"
                                                disabled={state === 'loading'}
                                            />
                                            <p className="text-xs text-gray-500 mt-1.5">
                                                In Google Photos, open the album → click <strong className="text-gray-400">Share</strong> → <strong className="text-gray-400">Copy link</strong>
                                            </p>
                                        </div>

                                        <button
                                            onClick={handleGoogleImport}
                                            disabled={!albumUrl || !selectedEventId || state === 'loading'}
                                            className="w-full py-4 bg-gradient-to-r from-purple-500 to-blue-500 rounded-xl font-bold text-lg hover:from-purple-600 hover:to-blue-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_0_30px_rgba(168,85,247,0.2)] hover:shadow-[0_0_40px_rgba(168,85,247,0.4)] hover:-translate-y-0.5 flex items-center justify-center gap-3"
                                        >
                                            {state === 'loading' ? (
                                                <>
                                                    <Loader2 className="w-5 h-5 animate-spin" />
                                                    Connecting…
                                                </>
                                            ) : (
                                                <>
                                                    <ImagePlus className="w-5 h-5" />
                                                    Import from Google Photos
                                                </>
                                            )}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── IMPORTING PROGRESS ──────────────────────────────── */}
                        {state === 'importing' && (
                            <div className="space-y-8 relative z-10">
                                <div className="text-center">
                                    <Loader2 className="w-12 h-12 text-purple-400 animate-spin mx-auto mb-4" />
                                    <p className="text-lg font-semibold text-white">
                                        {activeTab === 'upload' ? 'Uploading Photos…' : 'Importing Photos…'}
                                    </p>
                                    <p className="text-sm text-gray-400 mt-1">{statusMessage}</p>
                                </div>

                                {progress.total > 0 && (
                                    <>
                                        <div>
                                            <div className="flex justify-between text-sm text-gray-400 mb-2">
                                                <span>
                                                    {progress.current} / {progress.total} processed
                                                </span>
                                                <span>{progressPercent}%</span>
                                            </div>
                                            <div className="w-full h-3 bg-white/5 rounded-full overflow-hidden border border-white/10">
                                                <div
                                                    className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full transition-all duration-500 ease-out shadow-[0_0_12px_rgba(168,85,247,0.5)]"
                                                    style={{ width: `${progressPercent}%` }}
                                                />
                                            </div>
                                        </div>

                                        <div className="flex gap-6 justify-center">
                                            <div className="flex items-center gap-2 text-sm">
                                                <CheckCircle2 className="w-4 h-4 text-green-400" />
                                                <span className="text-green-300 font-medium">{progress.imported} imported</span>
                                            </div>
                                            {progress.failed > 0 && (
                                                <div className="flex items-center gap-2 text-sm">
                                                    <XCircle className="w-4 h-4 text-red-400" />
                                                    <span className="text-red-300 font-medium">{progress.failed} failed</span>
                                                </div>
                                            )}
                                        </div>
                                    </>
                                )}

                                {activeTab === 'google' && (
                                    <button
                                        onClick={() => abortRef.current?.abort()}
                                        className="w-full py-3 border border-white/10 rounded-xl text-sm text-gray-400 hover:text-white hover:border-white/30 transition"
                                    >
                                        Cancel Import
                                    </button>
                                )}
                            </div>
                        )}

                        {/* ── DONE ────────────────────────────────────────────── */}
                        {state === 'done' && (
                            <div className="space-y-8 relative z-10 text-center">
                                <div>
                                    <div className="w-20 h-20 bg-green-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-green-500/30">
                                        <CheckCircle2 className="w-10 h-10 text-green-400" />
                                    </div>
                                    <h2 className="text-2xl font-bold mb-2">
                                        {activeTab === 'upload' ? 'Upload' : 'Import'} Complete!
                                    </h2>
                                    <p className="text-gray-400">
                                        Successfully added <span className="text-white font-semibold">{progress.imported}</span> photo{progress.imported !== 1 ? 's' : ''}
                                        {progress.failed > 0 && (
                                            <span className="text-red-400"> ({progress.failed} failed)</span>
                                        )}
                                        {selectedEvent && (
                                            <span>
                                                {' '}to <span className="text-purple-300 font-semibold">{selectedEvent.name}</span>
                                            </span>
                                        )}
                                        .
                                    </p>
                                </div>

                                <div className="flex flex-col sm:flex-row gap-4">
                                    {selectedEvent && (
                                        <Link
                                            href={`/events/${selectedEvent.code}`}
                                            className="flex-1 py-3 bg-gradient-to-r from-purple-500 to-blue-500 rounded-xl font-semibold hover:from-purple-600 hover:to-blue-600 transition flex items-center justify-center gap-2"
                                        >
                                            View Event <ArrowRight className="w-4 h-4" />
                                        </Link>
                                    )}
                                    <button
                                        onClick={() => {
                                            setState('idle')
                                            setAlbumUrl('')
                                            setSelectedFiles([])
                                            setProgress({ imported: 0, failed: 0, current: 0, total: 0 })
                                            setAnalysisState('idle')
                                            setAnalysisMessage('')
                                        }}
                                        className="flex-1 py-3 border border-white/10 rounded-xl font-semibold text-gray-300 hover:text-white hover:border-white/30 transition"
                                    >
                                        Add More Photos
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* ── ERROR ───────────────────────────────────────────── */}
                        {state === 'error' && (
                            <div className="space-y-8 relative z-10 text-center">
                                <div>
                                    <div className="w-20 h-20 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-red-500/30">
                                        <XCircle className="w-10 h-10 text-red-400" />
                                    </div>
                                    <h2 className="text-2xl font-bold mb-2">
                                        {activeTab === 'upload' ? 'Upload' : 'Import'} Failed
                                    </h2>
                                    <p className="text-gray-400">{errorMessage}</p>
                                </div>

                                <button
                                    onClick={() => {
                                        setState('idle')
                                        setErrorMessage('')
                                        setAnalysisState('idle')
                                        setAnalysisMessage('')
                                    }}
                                    className="w-full py-3 bg-gradient-to-r from-purple-500 to-blue-500 rounded-xl font-semibold hover:from-purple-600 hover:to-blue-600 transition"
                                >
                                    Try Again
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    )
}

export default function ImportPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-black text-white flex items-center justify-center">
                <div className="animate-spin w-8 h-8 border-2 border-purple-400 border-t-transparent rounded-full" />
            </div>
        }>
            <ImportPageInner />
        </Suspense>
    )
}
