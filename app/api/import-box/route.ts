import { NextRequest } from 'next/server'
import { adminDb, adminStorage } from '@/lib/firebase-admin'
import { nanoid } from 'nanoid'

// Box shared folder/file import — uses public share links
// Requires a Box developer token or service account token for API access

export const maxDuration = 300
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidBoxUrl(url: string): boolean {
    try {
        const u = new URL(url)
        return (
            u.hostname === 'app.box.com' ||
            u.hostname === 'www.box.com' ||
            u.hostname.endsWith('.box.com')
        )
    } catch {
        return false
    }
}

/**
 * Extract the shared name from a Box shared link.
 * Box shared links look like: https://app.box.com/s/SHARED_NAME
 * or: https://app.box.com/v/VANITY_NAME
 */
function extractBoxSharedName(url: string): string | null {
    try {
        const u = new URL(url)
        const sMatch = u.pathname.match(/\/s\/([a-zA-Z0-9]+)/)
        if (sMatch) return sMatch[1]
        const vMatch = u.pathname.match(/\/v\/([a-zA-Z0-9_-]+)/)
        if (vMatch) return vMatch[1]
        return null
    } catch {
        return null
    }
}

function isImageOrVideo(name: string): boolean {
    const ext = name.split('.').pop()?.toLowerCase() || ''
    const mediaExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'mp4', 'mov', 'webm', 'avi', 'mkv']
    return mediaExts.includes(ext)
}

function mimeFromName(name: string): string {
    const ext = name.split('.').pop()?.toLowerCase() || ''
    const map: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
        heic: 'image/heic',
        heif: 'image/heif',
        mp4: 'video/mp4',
        mov: 'video/quicktime',
        webm: 'video/webm',
    }
    return map[ext] || 'image/jpeg'
}

function extFromName(name: string): string {
    return name.split('.').pop()?.toLowerCase() || 'jpg'
}

// ---------------------------------------------------------------------------
// POST /api/import-box
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

        if (!isValidBoxUrl(url)) {
            return Response.json(
                { error: 'Invalid Box URL. Please paste a shared folder or file link from Box.' },
                { status: 400 },
            )
        }

        const eventDoc = await adminDb.collection('events').doc(eventId).get()
        if (!eventDoc.exists) {
            return Response.json({ error: 'Event not found' }, { status: 404 })
        }

        const boxToken = process.env.BOX_ACCESS_TOKEN
        if (!boxToken) {
            return Response.json(
                { error: 'Box access token not configured. Set BOX_ACCESS_TOKEN env variable.' },
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
                    send({ type: 'status', message: 'Connecting to Box…' })

                    // Get the shared item using the BoxApi header
                    const headers = {
                        'Authorization': `Bearer ${boxToken}`,
                        'BoxApi': `shared_link=${url}`,
                    }

                    // First, get the shared item metadata
                    const metaRes = await fetch('https://api.box.com/2.0/shared_items', {
                        headers,
                    })

                    if (!metaRes.ok) {
                        const err = await metaRes.json().catch(() => ({}))
                        throw new Error(
                            err?.message ||
                            `Box API error: HTTP ${metaRes.status}. Make sure the link is set to "People with the link".`
                        )
                    }

                    const sharedItem = await metaRes.json()

                    type BoxFile = { id: string; name: string; size: number }
                    const files: BoxFile[] = []

                    if (sharedItem.type === 'folder') {
                        // List folder items via shared link
                        let offset = 0
                        const limit = 100
                        let totalCount = Infinity

                        while (offset < totalCount) {
                            const listRes = await fetch(
                                `https://api.box.com/2.0/folders/${sharedItem.id}/items?limit=${limit}&offset=${offset}&fields=id,name,type,size`,
                                { headers },
                            )

                            if (!listRes.ok) {
                                throw new Error(`Failed to list Box folder: HTTP ${listRes.status}`)
                            }

                            const listData = await listRes.json()
                            totalCount = listData.total_count || 0

                            for (const entry of listData.entries || []) {
                                if (entry.type === 'file' && isImageOrVideo(entry.name)) {
                                    files.push({
                                        id: entry.id,
                                        name: entry.name,
                                        size: entry.size || 0,
                                    })
                                }
                            }

                            offset += limit
                        }
                    } else if (sharedItem.type === 'file') {
                        if (isImageOrVideo(sharedItem.name)) {
                            files.push({
                                id: sharedItem.id,
                                name: sharedItem.name,
                                size: sharedItem.size || 0,
                            })
                        } else {
                            send({ type: 'error', message: `The file "${sharedItem.name}" is not an image or video.` })
                            controller.close()
                            return
                        }
                    }

                    if (files.length === 0) {
                        send({ type: 'error', message: 'No images or videos found in this Box folder.' })
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
                            // Download file content
                            const dlRes = await fetch(
                                `https://api.box.com/2.0/files/${file.id}/content`,
                                {
                                    headers,
                                    redirect: 'follow',
                                },
                            )

                            if (!dlRes.ok) throw new Error(`Download failed: HTTP ${dlRes.status}`)

                            const buffer = await dlRes.arrayBuffer()
                            if (buffer.byteLength === 0) throw new Error('Empty file')

                            const fileId = nanoid()
                            const ext = extFromName(file.name)
                            const mime = mimeFromName(file.name)
                            const storagePath = `events/${eventId}/${fileId}.${ext}`

                            const bucket = adminStorage.bucket()
                            const storageFile = bucket.file(storagePath)

                            await storageFile.save(Buffer.from(buffer), {
                                metadata: { contentType: mime },
                            })

                            await storageFile.makePublic()
                            const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`

                            await adminDb.collection('uploads').add({
                                event_id: eventId,
                                uploaded_by: uploaderId,
                                file_type: mime.startsWith('video/') ? 'video' : 'photo',
                                file_url: publicUrl,
                                file_size: buffer.byteLength,
                                created_at: new Date().toISOString(),
                                metadata: {
                                    source: 'box-import',
                                    original_name: file.name,
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
