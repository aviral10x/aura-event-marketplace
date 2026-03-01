// components/InfiniteScroll.tsx - Intersection Observer based infinite scroll
'use client'

import { useEffect, useRef } from 'react'

interface InfiniteScrollProps {
  onLoadMore: () => void | Promise<void>
  hasMore: boolean
  loading: boolean
  threshold?: number
  rootMargin?: string
  children?: React.ReactNode
}

export function InfiniteScroll({
  onLoadMore,
  hasMore,
  loading,
  threshold = 0.5,
  rootMargin = '100px',
  children,
}: InfiniteScrollProps) {
  const loadMoreRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!hasMore || loading) return

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0]
        if (first.isIntersecting) {
          onLoadMore()
        }
      },
      {
        threshold,
        rootMargin,
      }
    )

    const currentRef = loadMoreRef.current
    if (currentRef) {
      observer.observe(currentRef)
    }

    return () => {
      if (currentRef) {
        observer.unobserve(currentRef)
      }
    }
  }, [hasMore, loading, onLoadMore, threshold, rootMargin])

  return (
    <>
      {children}
      {hasMore && (
        <div
          ref={loadMoreRef}
          className="flex justify-center py-8"
        >
          {loading && (
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600" />
          )}
        </div>
      )}
    </>
  )
}

// Example usage:
/*
function EventsList() {
  const {
    items: events,
    loadMore,
    loading,
    hasMore,
  } = usePagination(fetchEvents)

  // Load initial data
  useEffect(() => {
    loadMore()
  }, [])

  return (
    <InfiniteScroll
      onLoadMore={loadMore}
      hasMore={hasMore}
      loading={loading}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {events.map((event) => (
          <EventCard key={event.id} event={event} />
        ))}
      </div>
    </InfiniteScroll>
  )
}
*/
