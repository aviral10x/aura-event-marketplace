import { NextRequest } from 'next/server'
import { adminDb, adminStorage } from '@/lib/firebase-admin'
import { nanoid } from 'nanoid'

// OneDrive / SharePoint shared folder import — uses anonymous share API
// No OAuth required: Microsoft Graph supports share-link-based anonymous access

export const maxDuration = 300
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidOneDriveUrl(url: string): boolean {
    try {
        const u = new URL(url)
        return (
            u.hostname.includes('onedrive.live.com') ||
            u.hostname.includes('1drv.ms') ||
            u.hostname.includes('sharepoint.com')
        )
    } catch {
        return false
    }
}

/**
 * Encode a sharing URL for Microsoft Graph's shares API.
 * See: https://learn.microsoft.com/en-us/graph/api/shares-get
 */
function encodeSharingUrl(url: string): string {
    const base64 = Buffer.from(url).toString('base64')
    // Convert to SharePoint-compatible format: replace + with -, / with _, trim =
    return 'u!' + base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
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
// POST /api/import-onedrive
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

        if (!isValidOneDriveUrl(url)) {
            return Response.json(
                { error: 'Invalid OneDrive/SharePoint URL. Please paste a shared folder or file link.' },
                { status: 400 },
            )
        }

        const eventDoc = await adminDb.collection('events').doc(eventId).get()
        if (!eventDoc.exists) {
            return Response.json({ error: 'Event not found' }, { status: 404 })
        }

        const encoder = new TextEncoder()

        const stream = new ReadableStream({
            async start(controller) {
                const send = (payload: Record<string, unknown>) => {
                    controller.enqueue(encoder.encode(JSON.stringify(payload) + '\n'))
                }

                try {
                    send({ type: 'status', message: 'Connecting to OneDrive…' })

                    const encodedUrl = encodeSharingUrl(url)
                    const graphBase = `https://graph.microsoft.com/v1.0/shares/${encodedUrl}`

                    // Get the shared drive item
                    const itemRes = await fetch(`${graphBase}/driveItem`, {
                        headers: { 'Accept': 'application/json' },
                    })

                    if (!itemRes.ok) {
                        const status = itemRes.status
                        if (status === 401 || status === 403) {
                            throw new Error('Access denied. Make sure the link is set to "Anyone with the link can view".')
                        }
                        throw new Error(`OneDrive API error: HTTP ${status}. Verify the shared link is accessible.`)
                    }

                    const rootItem = await itemRes.json()

                    type OneDriveFile = { id: string; name: string; mimeType: string; downloadUrl: string; size: number }
                    const files: OneDriveFile[] = []

                    if (rootItem.folder) {
                        // It's a folder — list children
                        const childrenRes = await fetch(`${graphBase}/driveItem/children?$select=id,name,file,size,@microsoft.graph.downloadUrl`, {
                            headers: { 'Accept': 'application/json' },
                        })

                        if (!childrenRes.ok) {
                            throw new Error(`Failed to list folder contents: HTTP ${childrenRes.status}`)
                        }

                        const childrenData = await childrenRes.json()
                        for (const child of childrenData.value || []) {
                            if (child.file && isImageOrVideo(child.file.mimeType)) {
                                files.push({
                                    id: child.id,
                                    name: child.name,
                                    mimeType: child.file.mimeType,
                                    downloadUrl: child['@microsoft.graph.downloadUrl'] || child['@content.downloadUrl'] || '',
                                    size: child.size || 0,
                                })
                            }
                        }
                    } else if (rootItem.file && isImageOrVideo(rootItem.file.mimeType)) {
                        // Single file
                        files.push({
                            id: rootItem.id,
                            name: rootItem.name,
                            mimeType: rootItem.file.mimeType,
                            downloadUrl: rootItem['@microsoft.graph.downloadUrl'] || rootItem['@content.downloadUrl'] || '',
                            size: rootItem.size || 0,
                        })
                    } else {
                        send({ type: 'error', message: 'The shared item is not an image/video file or folder.' })
                        controller.close()
                        return
                    }

                    if (files.length === 0) {
                        send({ type: 'error', message: 'No images or videos found in this OneDrive folder.' })
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
                            if (!file.downloadUrl) {
                                throw new Error('No download URL available for this file')
                            }

                            const dlRes = await fetch(file.downloadUrl)
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
                                    source: 'onedrive-import',
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
