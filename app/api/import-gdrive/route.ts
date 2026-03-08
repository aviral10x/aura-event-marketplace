import { NextRequest } from 'next/server'
import { adminDb, adminStorage } from '@/lib/firebase-admin'
import { nanoid } from 'nanoid'

// Google Drive shared folder/file import — uses public share links
// No OAuth required: works with "Anyone with the link" shared folders

export const maxDuration = 300
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the Google Drive folder or file ID from various URL formats:
 * - https://drive.google.com/drive/folders/FOLDER_ID?usp=sharing
 * - https://drive.google.com/file/d/FILE_ID/view?usp=sharing
 * - https://drive.google.com/open?id=ID
 */
function extractDriveId(url: string): { id: string; type: 'folder' | 'file' } | null {
    try {
        const u = new URL(url)
        if (!u.hostname.includes('drive.google.com') && !u.hostname.includes('docs.google.com')) {
            return null
        }

        // Folder: /drive/folders/ID
        const folderMatch = u.pathname.match(/\/folders\/([a-zA-Z0-9_-]+)/)
        if (folderMatch) return { id: folderMatch[1], type: 'folder' }

        // File: /file/d/ID
        const fileMatch = u.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)
        if (fileMatch) return { id: fileMatch[1], type: 'file' }

        // Open: ?id=ID
        const idParam = u.searchParams.get('id')
        if (idParam) return { id: idParam, type: 'file' }

        return null
    } catch {
        return null
    }
}

function isImageOrVideo(mimeType: string): boolean {
    return mimeType.startsWith('image/') || mimeType.startsWith('video/')
}

function extFromMime(mimeType: string): string {
    const map: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/heic': 'heic',
        'image/heif': 'heif',
        'video/mp4': 'mp4',
        'video/quicktime': 'mov',
        'video/webm': 'webm',
    }
    return map[mimeType] || 'jpg'
}

// ---------------------------------------------------------------------------
// POST /api/import-gdrive
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
    try {
        const { url, eventId } = (await request.json()) as {
            url?: string
            eventId?: string
        }

        if (!url || !eventId) {
            return Response.json(
                { error: 'url and eventId are required' },
                { status: 400 },
            )
        }

        const driveInfo = extractDriveId(url)
        if (!driveInfo) {
            return Response.json(
                { error: 'Invalid Google Drive URL. Please paste a shared folder or file link.' },
                { status: 400 },
            )
        }

        // Ensure event exists
        const eventDoc = await adminDb.collection('events').doc(eventId).get()
        if (!eventDoc.exists) {
            return Response.json({ error: 'Event not found' }, { status: 404 })
        }

        const apiKey = process.env.GOOGLE_API_KEY
        if (!apiKey) {
            return Response.json(
                { error: 'Google API key not configured. Set GOOGLE_API_KEY env variable.' },
                { status: 500 },
            )
        }

        const encoder = new TextEncoder()

        const stream = new ReadableStream({
            async start(controller) {
                const send = (payload: Record<string, unknown>) => {
                    controller.enqueue(encoder.encode(JSON.stringify(payload) + '\n'))
                }

                try {
                    send({ type: 'status', message: 'Connecting to Google Drive…' })

                    // Collect files to import
                    type DriveFile = { id: string; name: string; mimeType: string; size?: string }
                    const files: DriveFile[] = []

                    if (driveInfo.type === 'folder') {
                        // List files in shared folder using API key
                        let pageToken: string | undefined
                        do {
                            const params = new URLSearchParams({
                                q: `'${driveInfo.id}' in parents and (mimeType contains 'image/' or mimeType contains 'video/')`,
                                key: apiKey,
                                fields: 'nextPageToken,files(id,name,mimeType,size)',
                                pageSize: '100',
                            })
                            if (pageToken) params.set('pageToken', pageToken)

                            const res = await fetch(
                                `https://www.googleapis.com/drive/v3/files?${params}`,
                            )

                            if (!res.ok) {
                                const err = await res.json().catch(() => ({}))
                                throw new Error(
                                    err?.error?.message ||
                                    `Drive API error: HTTP ${res.status}. Make sure the folder is shared as "Anyone with the link".`
                                )
                            }

                            const data = await res.json()
                            if (data.files) files.push(...data.files)
                            pageToken = data.nextPageToken
                        } while (pageToken)
                    } else {
                        // Single file — get its metadata
                        const res = await fetch(
                            `https://www.googleapis.com/drive/v3/files/${driveInfo.id}?key=${apiKey}&fields=id,name,mimeType,size`,
                        )
                        if (!res.ok) {
                            throw new Error('Could not access the file. Make sure it is shared as "Anyone with the link".')
                        }
                        const file = await res.json()
                        if (isImageOrVideo(file.mimeType)) {
                            files.push(file)
                        } else {
                            send({ type: 'error', message: `The file "${file.name}" is not an image or video (${file.mimeType}).` })
                            controller.close()
                            return
                        }
                    }

                    if (files.length === 0) {
                        send({ type: 'error', message: 'No images or videos found in this Google Drive folder.' })
                        controller.close()
                        return
                    }

                    send({
                        type: 'status',
                        message: `Found ${files.length} file${files.length !== 1 ? 's' : ''}. Starting import…`,
                        total: files.length,
                    })

                    const uploaderId = eventDoc.data()?.created_by || null
                    let imported = 0
                    let failed = 0

                    for (let i = 0; i < files.length; i++) {
                        const file = files[i]

                        try {
                            // Download file using API key
                            const dlRes = await fetch(
                                `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${apiKey}`,
                            )
                            if (!dlRes.ok) throw new Error(`Download failed: HTTP ${dlRes.status}`)

                            const buffer = await dlRes.arrayBuffer()
                            if (buffer.byteLength === 0) throw new Error('Empty file')

                            const fileId = nanoid()
                            const ext = extFromMime(file.mimeType)
                            const storagePath = `events/${eventId}/${fileId}.${ext}`

                            const bucket = adminStorage.bucket()
                            const storageFile = bucket.file(storagePath)

                            await storageFile.save(Buffer.from(buffer), {
                                metadata: { contentType: file.mimeType },
                            })

                            await storageFile.makePublic()
                            const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`

                            await adminDb.collection('uploads').add({
                                event_id: eventId,
                                uploaded_by: uploaderId,
                                file_type: file.mimeType.startsWith('video/') ? 'video' : 'photo',
                                file_url: publicUrl,
                                file_size: buffer.byteLength,
                                created_at: new Date().toISOString(),
                                metadata: {
                                    source: 'google-drive-import',
                                    original_name: file.name,
                                    original_mime: file.mimeType,
                                },
                            })

                            imported++
                            send({
                                type: 'progress',
                                imported,
                                failed,
                                current: i + 1,
                                total: files.length,
                                fileName: file.name,
                            })
                        } catch (err: unknown) {
                            failed++
                            const message = err instanceof Error ? err.message : 'Unknown error'
                            send({
                                type: 'progress',
                                imported,
                                failed,
                                current: i + 1,
                                total: files.length,
                                error: message,
                            })
                        }
                    }

                    send({ type: 'complete', imported, failed, total: files.length })
                } catch (err: unknown) {
                    const message = err instanceof Error ? err.message : 'Unknown error'
                    send({ type: 'error', message })
                } finally {
                    controller.close()
                }
            },
        })

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Transfer-Encoding': 'chunked',
                'Cache-Control': 'no-cache',
            },
        })
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Internal server error'
        return Response.json({ error: message }, { status: 500 })
    }
}
