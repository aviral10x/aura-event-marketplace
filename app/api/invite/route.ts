// app/api/invite/route.ts — Manage invites for private events
import { NextRequest } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase-admin'
import { handleApiError } from '@/lib/error-handler'
import { FieldValue } from 'firebase-admin/firestore'

// POST — add invited emails to an existing event (creator-only)
export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { eventId, emails } = body

        if (!eventId || !Array.isArray(emails) || emails.length === 0) {
            return Response.json(
                { error: 'eventId and a non-empty emails array are required' },
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

        // Fetch the event
        const eventDoc = await adminDb.collection('events').doc(eventId).get()
        if (!eventDoc.exists) {
            return Response.json({ error: 'Event not found' }, { status: 404 })
        }

        const eventData = eventDoc.data()!

        // Only the creator can manage invites
        if (eventData.created_by !== uid) {
            return Response.json(
                { error: 'Only the event creator can manage invites' },
                { status: 403 }
            )
        }

        // Normalize emails
        const normalizedEmails = emails
            .map((e: string) => e.trim().toLowerCase())
            .filter((e: string) => e.length > 0 && e.includes('@'))

        // Merge into invited_emails (deduped via arrayUnion)
        await adminDb.collection('events').doc(eventId).update({
            invited_emails: FieldValue.arrayUnion(...normalizedEmails),
        })

        // Fetch updated doc
        const updatedDoc = await adminDb.collection('events').doc(eventId).get()
        const updatedEmails = updatedDoc.data()?.invited_emails || []

        return Response.json({
            success: true,
            invited_emails: updatedEmails,
        })
    } catch (error: any) {
        console.error('Error adding invites:', error)
        const { message, statusCode } = handleApiError(error)
        return Response.json({ error: message }, { status: statusCode })
    }
}

// DELETE — remove an invited email (creator-only)
export async function DELETE(request: NextRequest) {
    try {
        const body = await request.json()
        const { eventId, email } = body

        if (!eventId || !email) {
            return Response.json(
                { error: 'eventId and email are required' },
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

        // Fetch the event
        const eventDoc = await adminDb.collection('events').doc(eventId).get()
        if (!eventDoc.exists) {
            return Response.json({ error: 'Event not found' }, { status: 404 })
        }

        const eventData = eventDoc.data()!

        // Only the creator can manage invites
        if (eventData.created_by !== uid) {
            return Response.json(
                { error: 'Only the event creator can manage invites' },
                { status: 403 }
            )
        }

        // Remove the email
        const normalizedEmail = email.trim().toLowerCase()
        await adminDb.collection('events').doc(eventId).update({
            invited_emails: FieldValue.arrayRemove(normalizedEmail),
        })

        // Fetch updated doc
        const updatedDoc = await adminDb.collection('events').doc(eventId).get()
        const updatedEmails = updatedDoc.data()?.invited_emails || []

        return Response.json({
            success: true,
            invited_emails: updatedEmails,
        })
    } catch (error: any) {
        console.error('Error removing invite:', error)
        const { message, statusCode } = handleApiError(error)
        return Response.json({ error: message }, { status: statusCode })
    }
}
