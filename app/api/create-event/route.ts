// app/api/create-event/route.ts - UPDATED with rate limiting and error handling
import { NextRequest } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase-admin'
import { handleApiError } from '@/lib/error-handler'
import { withRateLimit, RateLimits } from '@/lib/rate-limit'

// Utility function to generate a random 8-character string for event code
const nanoid = (length: number = 8) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let result = ''
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
}

export async function POST(request: NextRequest) {
    // Apply rate limiting: 10 event creations per 10 seconds per IP
    return withRateLimit(
        request,
        async () => {
            try {
                const body = await request.json()
                const { name, description, location, startDate, endDate, isPublic, invitedEmails } = body

                if (!name) {
                    return Response.json(
                        { error: 'Event name is required' },
                        { status: 400 }
                    )
                }

                // Validate name length
                if (name.length < 3 || name.length > 100) {
                    return Response.json(
                        { error: 'Event name must be between 3 and 100 characters' },
                        { status: 400 }
                    )
                }

                // Authenticate the user
                const authHeader = request.headers.get('Authorization')
                if (!authHeader?.startsWith('Bearer ')) {
                    return Response.json(
                        { error: 'Unauthorized: Missing or invalid token' },
                        { status: 401 }
                    )
                }

                const idToken = authHeader.split('Bearer ')[1]
                const decodedToken = await adminAuth.verifyIdToken(idToken)
                const uid = decodedToken.uid

                // Ensure user profile exists
                const userRef = adminDb.collection('users').doc(uid)
                const userDoc = await userRef.get()
                if (!userDoc.exists) {
                    await userRef.set({
                        email: decodedToken.email || '',
                        full_name: decodedToken.name || decodedToken.email?.split('@')[0] || 'User',
                        created_at: new Date().toISOString(),
                    }, { merge: true })
                }

                // Generate unique code (retry if collision)
                let code = nanoid(8)
                let attempts = 0
                const maxAttempts = 5

                while (attempts < maxAttempts) {
                    const existingEvent = await adminDb
                        .collection('events')
                        .where('code', '==', code)
                        .limit(1)
                        .get()

                    if (existingEvent.empty) break

                    code = nanoid(8)
                    attempts++
                }

                if (attempts >= maxAttempts) {
                    return Response.json(
                        { error: 'Failed to generate unique event code. Please try again.' },
                        { status: 500 }
                    )
                }

                // Normalize invited emails to lowercase, dedup
                const normalizedEmails: string[] = Array.isArray(invitedEmails)
                    ? [...new Set(invitedEmails.map((e: string) => e.trim().toLowerCase()).filter((e: string) => e.length > 0))]
                    : []

                const newEvent = {
                    id: adminDb.collection('events').doc().id,
                    code,
                    name: name.trim(),
                    description: description?.trim() || null,
                    location: location?.trim() || null,
                    start_date: startDate || null,
                    end_date: endDate || null,
                    is_public: isPublic ?? true,
                    invited_emails: (isPublic ?? true) ? [] : normalizedEmails,
                    created_by: uid,
                    created_at: new Date().toISOString(),
                    // Additional metadata
                    upload_count: 0,
                    total_size_bytes: 0,
                }

                await adminDb.collection('events').doc(newEvent.id).set(newEvent)

                return Response.json({ event: newEvent })
            } catch (error: any) {
                console.error('Error creating event:', error)
                const { message, statusCode } = handleApiError(error)
                return Response.json({ error: message }, { status: statusCode })
            }
        },
        RateLimits.STANDARD // 30 requests per minute
    )
}
