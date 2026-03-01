// app/api/events/route.ts - Fetch events with pagination and caching
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase-admin'
import { handleApiError } from '@/lib/error-handler'
import { getCacheHeaders } from '@/lib/cache'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    
    const cursor = searchParams.get('cursor')
    const limit = parseInt(searchParams.get('limit') || '20')
    const onlyPublic = searchParams.get('public') !== 'false'

    // Validate limit
    if (limit < 1 || limit > 50) {
      return Response.json(
        { error: 'Limit must be between 1 and 50' },
        { status: 400 }
      )
    }

    // Build query
    let query = adminDb
      .collection('events')
      .orderBy('created_at', 'desc')

    // Filter for public events only
    if (onlyPublic) {
      query = query.where('is_public', '==', true) as any
    }

    // Apply cursor pagination
    if (cursor) {
      try {
        const cursorDoc = await adminDb.collection('events').doc(cursor).get()
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc) as any
        }
      } catch (error) {
        console.error('Invalid cursor:', error)
      }
    }

    // Fetch one extra to check if there are more
    const snapshot = await query.limit(limit + 1).get()
    const docs = snapshot.docs

    const hasMore = docs.length > limit
    const events = docs.slice(0, limit).map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }))

    const nextCursor = hasMore && events.length > 0
      ? events[events.length - 1].id
      : null

    const response = Response.json({
      events,
      hasMore,
      nextCursor,
      totalFetched: events.length,
    })

    // Add cache headers (medium: 5 minutes)
    const cacheHeaders = getCacheHeaders('medium')
    Object.entries(cacheHeaders).forEach(([key, value]) => {
      response.headers.set(key, value)
    })

    return response
  } catch (error: any) {
    console.error('Error fetching events:', error)
    const { message, statusCode } = handleApiError(error)
    return Response.json({ error: message }, { status: statusCode })
  }
}
