'use client'

import { useEffect, useState } from 'react'
import { db, auth } from '@/lib/firebase'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { onAuthStateChanged, User } from 'firebase/auth'
import Link from 'next/link'
import { Calendar, MapPin, Plus, Lock, Globe, Loader2 } from 'lucide-react'

// Define Event inline locally as it used to come from lib/supabase
export interface Event {
  id: string;
  code: string;
  name: string;
  description?: string;
  location?: string;
  start_date?: string;
  end_date?: string;
  is_public: boolean;
  created_at?: string;
  created_by?: string;
  cover_image?: string;
  invited_emails?: string[];
}

type TabKey = 'public' | 'invited'

export default function Events() {
  const [publicEvents, setPublicEvents] = useState<Event[]>([])
  const [invitedEvents, setInvitedEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabKey>('public')
  const [currentUser, setCurrentUser] = useState<User | null>(null)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user)
    })
    return () => unsubscribe()
  }, [])

  useEffect(() => {
    fetchEvents()
  }, [currentUser])

  const fetchEvents = async () => {
    setLoading(true)
    try {
      // Fetch ALL events (no composite index needed)
      const querySnapshot = await getDocs(collection(db, 'events'))
      const allEvents: Event[] = []
      querySnapshot.forEach((d) => {
        allEvents.push({ id: d.id, ...d.data() } as Event)
      })

      // Public events — filter to public & sort by created_at desc
      const pubEvents = allEvents
        .filter(e => e.is_public !== false) // treat missing is_public as true
        .sort((a, b) => {
          const dateA = new Date(a.created_at || 0).getTime()
          const dateB = new Date(b.created_at || 0).getTime()
          return dateB - dateA
        })
      setPublicEvents(pubEvents)

      // Invited events — private events where the user's email is in invited_emails or user is creator
      if (currentUser?.email) {
        const userEmail = currentUser.email.toLowerCase()
        const invEvents = allEvents
          .filter(e => {
            if (e.is_public !== false) return false // only private events
            const isInvited = Array.isArray(e.invited_emails) && e.invited_emails.includes(userEmail)
            const isCreator = e.created_by === currentUser.uid
            return isInvited || isCreator
          })
          .sort((a, b) => {
            const dateA = new Date(a.created_at || 0).getTime()
            const dateB = new Date(b.created_at || 0).getTime()
            return dateB - dateA
          })
        setInvitedEvents(invEvents)
      } else {
        setInvitedEvents([])
      }
    } catch (error) {
      console.error('Error fetching events:', error)
    } finally {
      setLoading(false)
    }
  }

  const events = activeTab === 'public' ? publicEvents : invitedEvents

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="border-b border-white/10">
        <div className="container mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <Link href="/" className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
              AURA
            </Link>
            <Link
              href="/create"
              className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full hover:from-purple-600 hover:to-blue-600 transition"
            >
              <Plus className="w-5 h-5" />
              Create Event
            </Link>
          </div>
        </div>
      </div>

      {/* Events Content */}
      <div className="container mx-auto px-6 py-12">
        <h1 className="text-4xl font-bold mb-8">Discover Events</h1>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-8 p-1 bg-white/5 rounded-xl border border-white/10 w-fit">
          <button
            onClick={() => setActiveTab('public')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'public'
                ? 'bg-gradient-to-r from-purple-500/20 to-blue-500/20 text-white border border-purple-500/30 shadow-lg shadow-purple-500/5'
                : 'text-gray-400 hover:text-gray-200 border border-transparent'
            }`}
          >
            <Globe className="w-4 h-4" />
            Public Events
            {publicEvents.length > 0 && (
              <span className={`px-2 py-0.5 rounded-full text-xs ${
                activeTab === 'public' ? 'bg-purple-500/20 text-purple-300' : 'bg-white/10 text-gray-400'
              }`}>
                {publicEvents.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('invited')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'invited'
                ? 'bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-white border border-amber-500/30 shadow-lg shadow-amber-500/5'
                : 'text-gray-400 hover:text-gray-200 border border-transparent'
            }`}
          >
            <Lock className="w-4 h-4" />
            My Invites
            {invitedEvents.length > 0 && (
              <span className={`px-2 py-0.5 rounded-full text-xs ${
                activeTab === 'invited' ? 'bg-amber-500/20 text-amber-300' : 'bg-white/10 text-gray-400'
              }`}>
                {invitedEvents.length}
              </span>
            )}
          </button>
        </div>

        {/* Not signed in notice for My Invites */}
        {activeTab === 'invited' && !currentUser && (
          <div className="text-center py-12 glass-panel rounded-2xl border border-white/10">
            <Lock className="w-12 h-12 text-amber-400/40 mx-auto mb-4" />
            <p className="text-gray-400 mb-4">Sign in to see events you&apos;ve been invited to</p>
            <Link
              href="/auth/signin"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full hover:from-purple-600 hover:to-blue-600 transition font-medium"
            >
              Sign In
            </Link>
          </div>
        )}

        {loading ? (
          <div className="text-center py-12 text-gray-400 flex items-center justify-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading events...
          </div>
        ) : (activeTab === 'public' || currentUser) && events.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400 mb-6">
              {activeTab === 'public'
                ? 'No events yet. Be the first to create one!'
                : 'You haven\'t been invited to any private events yet.'}
            </p>
            {activeTab === 'public' && (
              <Link
                href="/create"
                className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full hover:from-purple-600 hover:to-blue-600 transition"
              >
                <Plus className="w-5 h-5" />
                Create Event
              </Link>
            )}
          </div>
        ) : (activeTab === 'public' || currentUser) && (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {events.map((event) => (
              <Link
                key={event.id}
                href={`/events/${event.code}`}
                className="group bg-gradient-to-br from-white/5 to-transparent border border-white/10 rounded-2xl overflow-hidden hover:border-purple-500/40 transition relative"
              >
                {/* Private badge */}
                {!event.is_public && (
                  <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/15 backdrop-blur-md border border-amber-500/25 rounded-full">
                    <Lock className="w-3 h-3 text-amber-400" />
                    <span className="text-[10px] font-semibold text-amber-300 uppercase tracking-wider">Private</span>
                  </div>
                )}

                {event.cover_image ? (
                  <div className="aspect-video bg-gradient-to-br from-purple-900/20 to-blue-900/20" />
                ) : (
                  <div className={`aspect-video flex items-center justify-center ${
                    event.is_public
                      ? 'bg-gradient-to-br from-purple-900/20 to-blue-900/20'
                      : 'bg-gradient-to-br from-amber-900/15 to-orange-900/15'
                  }`}>
                    <Calendar className="w-16 h-16 text-white/20" />
                  </div>
                )}
                <div className="p-6">
                  <h3 className="text-xl font-bold mb-2 group-hover:text-purple-400 transition">
                    {event.name}
                  </h3>
                  {event.description && (
                    <p className="text-gray-400 text-sm mb-4 line-clamp-2">
                      {event.description}
                    </p>
                  )}
                  {event.location && (
                    <div className="flex items-center gap-2 text-sm text-gray-400 mb-2">
                      <MapPin className="w-4 h-4" />
                      {event.location}
                    </div>
                  )}
                  {event.start_date && (
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <Calendar className="w-4 h-4" />
                      {new Date(event.start_date).toLocaleDateString()}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

