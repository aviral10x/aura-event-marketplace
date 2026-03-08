import { NextRequest } from 'next/server'
import { adminDb, adminStorage } from '@/lib/firebase-admin'
import { nanoid } from 'nanoid'

// Dropbox shared folder/file import — uses public share links
// No OAuth required: Dropbox APIs support shared_link access

export const maxDuration = 300
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidDropboxUrl(url: string): boolean {
    try {
        const u = new URL(url)
        return (
            u.hostname === 'www.dropbox.com' ||
            u.hostname === 'dropbox.com' ||
            u.hostname === 'dl.dropboxusercontent.com'
        )
    } catch {
        return false
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
// POST /api/import-dropbox
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

        if (!isValidDropboxUrl(url)) {
            return Response.json(
                { error: 'Invalid Dropbox URL. Please paste a shared folder or file link from Dropbox.' },
                { status: 400 },
            )
        }

        const eventDoc = await adminDb.collection('events').doc(eventId).get()
        if (!eventDoc.exists) {
            return Response.json({ error: 'Event not found' }, { status: 404 })
        }

        const dropboxToken = process.env.DROPBOX_ACCESS_TOKEN
        if (!dropboxToken) {
            return Response.json(
                { error: 'Dropbox access token not configured. Set DROPBOX_ACCESS_TOKEN env variable.' },
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
                    send({ type: 'status', message: 'Connecting to Dropbox…' })

                    // Get shared link metadata to determine if folder or file
                    const metaRes = await fetch('https://api.dropboxapi.com/2/sharing/get_shared_link_metadata', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${dropboxToken}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ url }),
                    })

                    if (!metaRes.ok) {
                        const err = await metaRes.json().catch(() => ({}))
                        throw new Error(
                            err?.error_summary ||
                            `Dropbox API error: HTTP ${metaRes.status}. Make sure the link has "Anyone with the link" access.`
                        )
                    }

                    const meta = await metaRes.json()

                    type DropboxFile = { name: string; path_lower: string; size: number }
                    const files: DropboxFile[] = []

                    if (meta['.tag'] === 'folder') {
                        // List folder contents via shared link
                        let hasMore = true
                        let cursor: string | undefined

                        while (hasMore) {
                            let listRes: Response

                            if (!cursor) {
                                listRes = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
                                    method: 'POST',
                                    headers: {
                                        'Authorization': `Bearer ${dropboxToken}`,
                                        'Content-Type': 'application/json',
                                    },
                                    body: JSON.stringify({
                                        path: '',
                                        shared_link: { url },
                                        limit: 100,
                                    }),
                                })
                            } else {
                                listRes = await fetch('https://api.dropboxapi.com/2/files/list_folder/continue', {
                                    method: 'POST',
                                    headers: {
                                        'Authorization': `Bearer ${dropboxToken}`,
                                        'Content-Type': 'application/json',
                                    },
                                    body: JSON.stringify({ cursor }),
                                })
                            }

                            if (!listRes.ok) {
                                throw new Error(`Failed to list Dropbox folder: HTTP ${listRes.status}`)
                            }

                            const listData = await listRes.json()
                            for (const entry of listData.entries || []) {
                                if (entry['.tag'] === 'file' && isImageOrVideo(entry.name)) {
                                    files.push({
                                        name: entry.name,
                                        path_lower: entry.path_lower,
                                        size: entry.size,
                                    })
                                }
                            }

                            hasMore = listData.has_more
                            cursor = listData.cursor
                        }
                    } else if (meta['.tag'] === 'file') {
                        if (isImageOrVideo(meta.name)) {
                            files.push({
                                name: meta.name,
                                path_lower: meta.path_lower,
                                size: meta.size,
                            })
                        } else {
                            send({ type: 'error', message: `The file "${meta.name}" is not an image or video.` })
                            controller.close()
                            return
                        }
                    }

                    if (files.length === 0) {
                        send({ type: 'error', message: 'No images or videos found in this Dropbox folder.' })
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
                            // Download via shared link
                            const dlRes = await fetch('https://content.dropboxapi.com/2/sharing/get_shared_link_file', {
                                method: 'POST',
                                headers: {
                                    'Authorization': `Bearer ${dropboxToken}`,
                                    'Dropbox-API-Arg': JSON.stringify({
                                        url,
                                        path: file.path_lower,
                                    }),
                                },
                            })

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
                                    source: 'dropbox-import',
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
