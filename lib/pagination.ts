// lib/pagination.ts
/**
 * Pagination utilities for Firestore
 * Supports cursor-based pagination for efficient large dataset handling
 */

import {
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
  QueryDocumentSnapshot,
  DocumentData,
  Query,
  Firestore,
} from 'firebase/firestore';

export interface PaginationOptions {
  pageSize?: number;
  orderByField?: string;
  orderDirection?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  items: T[];
  hasMore: boolean;
  nextCursor: string | null;
  totalFetched: number;
}

const DEFAULT_PAGE_SIZE = 20;

/**
 * Paginate Firestore query results
 */
export async function paginateQuery<T = DocumentData>(
  db: Firestore,
  collectionName: string,
  filters: Array<{ field: string; operator: any; value: any }> = [],
  cursor: string | null = null,
  options: PaginationOptions = {}
): Promise<PaginatedResult<T>> {
  const pageSize = options.pageSize || DEFAULT_PAGE_SIZE;
  const orderField = options.orderByField || 'created_at';
  const orderDir = options.orderDirection || 'desc';

  // Build base query
  let q: Query = collection(db, collectionName);

  // Apply filters
  for (const filter of filters) {
    q = query(q, where(filter.field, filter.operator, filter.value));
  }

  // Apply ordering
  q = query(q, orderBy(orderField, orderDir));

  // Apply cursor if provided
  if (cursor) {
    try {
      const cursorDoc = await getCursorDocument(db, collectionName, cursor);
      if (cursorDoc) {
        q = query(q, startAfter(cursorDoc));
      }
    } catch (error) {
      console.error('Failed to apply cursor:', error);
    }
  }

  // Fetch one extra to check if there are more results
  q = query(q, limit(pageSize + 1));

  const snapshot = await getDocs(q);
  const docs = snapshot.docs;

  // Check if there are more results
  const hasMore = docs.length > pageSize;

  // Get actual results (exclude extra doc)
  const items = docs.slice(0, pageSize).map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as T[];

  // Get next cursor (last doc ID)
  const nextCursor = hasMore && docs.length > 0 ? docs[pageSize - 1].id : null;

  return {
    items,
    hasMore,
    nextCursor,
    totalFetched: items.length,
  };
}

/**
 * Get document by ID for cursor
 */
async function getCursorDocument(
  db: Firestore,
  collectionName: string,
  docId: string
): Promise<QueryDocumentSnapshot | null> {
  const snapshot = await getDocs(
    query(collection(db, collectionName), where('__name__', '==', docId))
  );

  return snapshot.docs[0] || null;
}

/**
 * Infinite scroll hook helper
 */
export class InfiniteScroller<T> {
  private cursor: string | null = null;
  private loading = false;
  private hasMore = true;

  constructor(
    private fetchFn: (cursor: string | null) => Promise<PaginatedResult<T>>
  ) {}

  async loadMore(): Promise<T[]> {
    if (this.loading || !this.hasMore) {
      return [];
    }

    this.loading = true;

    try {
      const result = await this.fetchFn(this.cursor);
      this.cursor = result.nextCursor;
      this.hasMore = result.hasMore;
      return result.items;
    } finally {
      this.loading = false;
    }
  }

  reset() {
    this.cursor = null;
    this.hasMore = true;
  }

  isLoading() {
    return this.loading;
  }

  canLoadMore() {
    return this.hasMore && !this.loading;
  }
}

/**
 * Client-side pagination state manager
 */
export class PaginationState<T> {
  private items: T[] = [];
  private cursor: string | null = null;
  private hasMore = true;
  private loading = false;

  getItems(): T[] {
    return this.items;
  }

  async loadPage(
    fetchFn: (cursor: string | null) => Promise<PaginatedResult<T>>
  ): Promise<void> {
    if (this.loading || !this.hasMore) return;

    this.loading = true;

    try {
      const result = await fetchFn(this.cursor);
      this.items = [...this.items, ...result.items];
      this.cursor = result.nextCursor;
      this.hasMore = result.hasMore;
    } finally {
      this.loading = false;
    }
  }

  reset(): void {
    this.items = [];
    this.cursor = null;
    this.hasMore = true;
    this.loading = false;
  }

  isLoading(): boolean {
    return this.loading;
  }

  canLoadMore(): boolean {
    return this.hasMore && !this.loading;
  }

  getTotalLoaded(): number {
    return this.items.length;
  }
}

/**
 * React hook for pagination (copy to component)
 */
/*
import { useState, useCallback } from 'react'

export function usePagination<T>(
  fetchFn: (cursor: string | null) => Promise<PaginatedResult<T>>
) {
  const [items, setItems] = useState<T[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return

    setLoading(true)
    try {
      const result = await fetchFn(cursor)
      setItems(prev => [...prev, ...result.items])
      setCursor(result.nextCursor)
      setHasMore(result.hasMore)
    } finally {
      setLoading(false)
    }
  }, [cursor, hasMore, loading, fetchFn])

  const reset = useCallback(() => {
    setItems([])
    setCursor(null)
    setHasMore(true)
  }, [])

  return {
    items,
    loadMore,
    reset,
    loading,
    hasMore,
  }
}
*/
