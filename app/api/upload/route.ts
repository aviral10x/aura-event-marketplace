// app/api/upload/route.ts - Upload with optimization and rate limiting
import { NextRequest } from 'next/server'
import { adminAuth, adminDb, adminStorage } from '@/lib/firebase-admin'
import { handleApiError } from '@/lib/error-handler'
import { withRateLimit, RateLimits } from '@/lib/rate-limit'

export const config = {
  api: {
    bodyParser: false, // Disable default body parser for file uploads
  },
}

export async function POST(request: NextRequest) {
  // Apply strict rate limiting for uploads
  return withRateLimit(
    request,
    async () => {
      try {
        // Authenticate user
        const authHeader = request.headers.get('Authorization')
        if (!authHeader?.startsWith('Bearer ')) {
          return Response.json(
            { error: 'Unauthorized' },
            { status: 401 }
          )
        }

        const idToken = authHeader.split('Bearer ')[1]
        const decodedToken = await adminAuth.verifyIdToken(idToken)
        const uid = decodedToken.uid

        // Parse multipart form data
        const formData = await request.formData()
        const eventId = formData.get('eventId') as string
        const file = formData.get('file') as File
        const compressed = formData.get('compressed') as File | null
        const thumbnail = formData.get('thumbnail') as File | null

        if (!eventId || !file) {
          return Response.json(
            { error: 'Event ID and file are required' },
            { status: 400 }
          )
        }

        // Validate event exists and user has permission
        const eventRef = adminDb.collection('events').doc(eventId)
        const eventDoc = await eventRef.get()

        if (!eventDoc.exists) {
          return Response.json(
            { error: 'Event not found' },
            { status: 404 }
          )
        }

        const event = eventDoc.data()!

        // Check if user is event creator or event is public
        if (!event.is_public && event.created_by !== uid) {
          return Response.json(
            { error: 'You do not have permission to upload to this event' },
            { status: 403 }
          )
        }

        // Validate file size (100MB max)
        const maxSize = 100 * 1024 * 1024 // 100MB
        if (file.size > maxSize) {
          return Response.json(
            { error: 'File size must be less than 100MB' },
            { status: 400 }
          )
        }

        // Validate file type
        const validTypes = [
          'image/jpeg',
          'image/jpg',
          'image/png',
          'image/webp',
          'image/heic',
          'video/mp4',
          'video/quicktime',
          'video/webm',
        ]

        if (!validTypes.includes(file.type)) {
          return Response.json(
            { error: 'Invalid file type. Only images and videos are allowed.' },
            { status: 400 }
          )
        }

        // Generate unique filenames
        const timestamp = Date.now()
        const ext = file.name.split('.').pop()
        const fileType = file.type.startsWith('image/') ? 'photo' : 'video'

        const originalPath = `events/${eventId}/original/${timestamp}.${ext}`
        const compressedPath = compressed
          ? `events/${eventId}/compressed/${timestamp}.${ext}`
          : null
        const thumbnailPath = thumbnail
          ? `events/${eventId}/thumbnails/${timestamp}.${ext}`
          : null

        // Upload files to Firebase Storage
        const bucket = adminStorage.bucket()

        // Upload original
        const originalBuffer = Buffer.from(await file.arrayBuffer())
        const originalFile = bucket.file(originalPath)
        await originalFile.save(originalBuffer, {
          metadata: {
            contentType: file.type,
            metadata: {
              uploadedBy: uid,
              eventId,
              originalName: file.name,
            },
          },
        })

        await originalFile.makePublic()
        const originalUrl = `https://storage.googleapis.com/${bucket.name}/${originalPath}`

        // Upload compressed if provided
        let compressedUrl = null
        if (compressed && compressedPath) {
          const compressedBuffer = Buffer.from(await compressed.arrayBuffer())
          const compressedFile = bucket.file(compressedPath)
          await compressedFile.save(compressedBuffer, {
            metadata: { contentType: compressed.type },
          })
          await compressedFile.makePublic()
          compressedUrl = `https://storage.googleapis.com/${bucket.name}/${compressedPath}`
        }

        // Upload thumbnail if provided
        let thumbnailUrl = null
        if (thumbnail && thumbnailPath) {
          const thumbnailBuffer = Buffer.from(await thumbnail.arrayBuffer())
          const thumbnailFile = bucket.file(thumbnailPath)
          await thumbnailFile.save(thumbnailBuffer, {
            metadata: { contentType: thumbnail.type },
          })
          await thumbnailFile.makePublic()
          thumbnailUrl = `https://storage.googleapis.com/${bucket.name}/${thumbnailPath}`
        }

        // Create upload document in Firestore
        const uploadData = {
          event_id: eventId,
          uploaded_by: uid,
          file_type: fileType,
          file_url: compressedUrl || originalUrl,
          original_url: originalUrl,
          thumbnail_url: thumbnailUrl,
          file_size: file.size,
          compressed_size: compressed?.size || null,
          ai_tags: [], // Will be populated by separate tagging process
          created_at: new Date().toISOString(),
          metadata: {
            original_name: file.name,
            mime_type: file.type,
          },
        }

        const uploadRef = await adminDb.collection('uploads').add(uploadData)

        // Update event statistics
        await eventRef.update({
          upload_count: (event.upload_count || 0) + 1,
          total_size_bytes: (event.total_size_bytes || 0) + file.size,
        })

        return Response.json({
          success: true,
          upload: {
            id: uploadRef.id,
            ...uploadData,
          },
        })
      } catch (error: any) {
        console.error('Upload error:', error)
        const { message, statusCode } = handleApiError(error)
        return Response.json({ error: message }, { status: statusCode })
      }
    },
    RateLimits.UPLOAD // 5 uploads per minute
  )
}
