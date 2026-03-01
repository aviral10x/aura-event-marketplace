'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
    Sparkles,
    CalendarDays,
    MapPin,
    Type,
    FileText,
    ArrowRight,
    Plus,
} from 'lucide-react'
import { auth } from '@/lib/firebase'
import { handleFirebaseError } from '@/lib/error-handler'
import { ButtonSpinner } from '@/components/ui/loading-spinner'


export default function CreateEvent() {
    const router = useRouter()
    const [loading, setLoading] = useState(false)

    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [location, setLocation] = useState('')
    const [startDate, setStartDate] = useState('')
    const [endDate, setEndDate] = useState('')
    const [isPublic, setIsPublic] = useState(true)

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault()
        
        // Basic validation
        if (name.length < 3) {
            toast.error('Event name must be at least 3 characters')
            return
        }
        
        setLoading(true)

        try {
            const currentUser = auth.currentUser;
            if (!currentUser) {
                toast.error('Please sign in to create an event');
                router.push('/auth/signin');
                setLoading(false);
                return;
            }

            const token = await currentUser.getIdToken();

            const res = await fetch('/api/create-event', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    name,
                    description: description || null,
                    location: location || null,
                    startDate: startDate || null,
                    endDate: endDate || null,
                    isPublic,
                }),
            })

            const result = await res.json()

            if (!res.ok) {
                toast.error(result.error || 'Failed to create event')
                setLoading(false)
                return
            }

            // Success!
            toast.success('Event created! 🎉')
            
            // Redirect to the import page
            router.push(`/import?eventId=${result.event.id}`)
        } catch (err) {
            toast.error(handleFirebaseError(err))
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen bg-black text-white relative flex flex-col">
            {/* Background effects */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-purple-900/10 via-black to-blue-900/10" />
                <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-600/20 rounded-full mix-blend-screen filter blur-[120px] animate-blob" />
                <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-purple-600/20 rounded-full mix-blend-screen filter blur-[120px] animate-blob animation-delay-2000" />
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
                    <div className="flex items-center gap-6">
                        <Link
                            href="/events"
                            className="text-sm font-medium text-gray-300 hover:text-white transition-colors"
                        >
                            Browse Events
                        </Link>
                        <Link
                            href="/import"
                            className="text-sm font-medium text-gray-300 hover:text-white transition-colors"
                        >
                            Import Photos
                        </Link>
                    </div>
                </div>
            </nav>

            {/* Content */}
            <main className="flex-1 relative z-10 flex items-start justify-center px-6 py-16 md:py-20">
                <div className="w-full max-w-2xl">
                    {/* Header */}
                    <div className="text-center mb-12">
                        <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/20 rounded-full mb-6 shadow-lg shadow-blue-500/5">
                            <Plus className="w-4 h-4 text-blue-400" />
                            <span className="text-sm font-medium text-blue-200 tracking-wide uppercase">
                                New Event
                            </span>
                        </div>
                        <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
                            Create an{' '}
                            <span className="bg-gradient-to-r from-purple-400 via-pink-500 to-blue-500 bg-clip-text text-transparent">
                                Event
                            </span>
                        </h1>
                        <p className="text-lg text-gray-400 max-w-xl mx-auto">
                            Set up your event so contributors can upload and you can import content.
                        </p>
                    </div>

                    {/* Form Card */}
                    <div className="glass-panel rounded-3xl p-8 md:p-10 relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-40 h-40 bg-blue-500/10 rounded-br-full blur-2xl pointer-events-none" />

                        <form onSubmit={handleCreate} className="space-y-6 relative z-10">
                            {/* Event Name */}
                            <div>
                                <label className="block text-sm font-medium mb-2 text-gray-300">
                                    <Type className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                                    Event Name <span className="text-red-400">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    placeholder="e.g. Sarah's Wedding Reception"
                                    className="w-full px-5 py-4 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/20 transition text-white placeholder:text-gray-600 text-base"
                                    required
                                    disabled={loading}
                                />
                            </div>

                            {/* Description */}
                            <div>
                                <label className="block text-sm font-medium mb-2 text-gray-300">
                                    <FileText className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                                    Description
                                </label>
                                <textarea
                                    value={description}
                                    onChange={e => setDescription(e.target.value)}
                                    placeholder="What's this event about?"
                                    rows={3}
                                    className="w-full px-5 py-4 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/20 transition text-white placeholder:text-gray-600 text-base resize-none"
                                    disabled={loading}
                                />
                            </div>

                            {/* Location */}
                            <div>
                                <label className="block text-sm font-medium mb-2 text-gray-300">
                                    <MapPin className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                                    Location
                                </label>
                                <input
                                    type="text"
                                    value={location}
                                    onChange={e => setLocation(e.target.value)}
                                    placeholder="e.g. Grand Hyatt, Mumbai"
                                    className="w-full px-5 py-4 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/20 transition text-white placeholder:text-gray-600 text-base"
                                    disabled={loading}
                                />
                            </div>

                            {/* Dates */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium mb-2 text-gray-300">
                                        <CalendarDays className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                                        Start Date
                                    </label>
                                    <input
                                        type="datetime-local"
                                        value={startDate}
                                        onChange={e => setStartDate(e.target.value)}
                                        className="w-full px-5 py-4 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/20 transition text-white text-base [color-scheme:dark]"
                                        disabled={loading}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-2 text-gray-300">
                                        <CalendarDays className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                                        End Date
                                    </label>
                                    <input
                                        type="datetime-local"
                                        value={endDate}
                                        onChange={e => setEndDate(e.target.value)}
                                        className="w-full px-5 py-4 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/20 transition text-white text-base [color-scheme:dark]"
                                        disabled={loading}
                                    />
                                </div>
                            </div>

                            {/* Visibility Toggle */}
                            <div className="flex items-center justify-between p-4 bg-white/[0.03] rounded-xl border border-white/5">
                                <div>
                                    <p className="text-sm font-medium text-white">Public Event</p>
                                    <p className="text-xs text-gray-500 mt-0.5">Anyone can browse and purchase content</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsPublic(!isPublic)}
                                    className={`relative w-12 h-7 rounded-full transition-colors ${isPublic ? 'bg-purple-500' : 'bg-white/10'
                                        }`}
                                    disabled={loading}
                                >
                                    <div
                                        className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${isPublic ? 'translate-x-5' : 'translate-x-0'
                                            }`}
                                    />
                                </button>
                            </div>

                            {/* Submit */}
                            <button
                                type="submit"
                                disabled={!name || loading}
                                className="w-full py-4 bg-gradient-to-r from-purple-500 to-blue-500 rounded-xl font-bold text-lg hover:from-purple-600 hover:to-blue-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_0_30px_rgba(168,85,247,0.2)] hover:shadow-[0_0_40px_rgba(168,85,247,0.4)] hover:-translate-y-0.5 flex items-center justify-center gap-3"
                            >
                                {loading ? (
                                    <>
                                        <ButtonSpinner />
                                        Creating…
                                    </>
                                ) : (
                                    <>
                                        Create Event <ArrowRight className="w-5 h-5" />
                                    </>
                                )}
                            </button>
                        </form>
                    </div>
                </div>
            </main>
        </div>
    )
}
