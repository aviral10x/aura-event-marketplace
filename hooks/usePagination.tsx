// hooks/usePagination.tsx - React hook for pagination
import { useState, useCallback } from 'react'

export interface PaginatedResult<T> {
  items: T[]
  hasMore: boolean
  nextCursor: string | null
  totalFetched: number
}

export function usePagination<T>(
  fetchFn: (cursor: string | null) => Promise<PaginatedResult<T>>
) {
  const [items, setItems] = useState<T[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return

    setLoading(true)
    setError(null)

    try {
      const result = await fetchFn(cursor)
      setItems((prev) => [...prev, ...result.items])
      setCursor(result.nextCursor)
      setHasMore(result.hasMore)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setLoading(false)
    }
  }, [cursor, hasMore, loading, fetchFn])

  const reset = useCallback(() => {
    setItems([])
    setCursor(null)
    setHasMore(true)
    setError(null)
  }, [])

  const refresh = useCallback(async () => {
    reset()
    setLoading(true)
    setError(null)

    try {
      const result = await fetchFn(null)
      setItems(result.items)
      setCursor(result.nextCursor)
      setHasMore(result.hasMore)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setLoading(false)
    }
  }, [fetchFn, reset])

  return {
    items,
    loadMore,
    reset,
    refresh,
    loading,
    hasMore,
    error,
  }
}

// Example usage:
/*
function EventsList() {
  const fetchEvents = async (cursor: string | null) => {
    const params = new URLSearchParams()
    if (cursor) params.set('cursor', cursor)
    params.set('limit', '20')

    const res = await fetch(`/api/events?${params}`)
    if (!res.ok) throw new Error('Failed to fetch events')
    return res.json()
  }

  const {
    items: events,
    loadMore,
    loading,
    hasMore,
    error,
  } = usePagination(fetchEvents)

  // Load initial data
  useEffect(() => {
    loadMore()
  }, [])

  return (
    <div>
      {events.map((event) => (
        <EventCard key={event.id} event={event} />
      ))}

      {hasMore && (
        <button onClick={loadMore} disabled={loading}>
          {loading ? 'Loading...' : 'Load More'}
        </button>
      )}

      {error && <div>Error: {error.message}</div>}
    </div>
  )
}
*/
