/**
 * useSearch.js — Search hook that uses backend Socket.IO search event.
 */
import { useState, useCallback, useRef } from 'react';
import { useSocketEvent } from './useSocket';
import socket from '../socket';

export function useSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const searchIdRef = useRef(0);

  useSocketEvent('search-results', (data) => {
    if (data._searchId && data._searchId !== searchIdRef.current) return;
    setResults(prev => data.page > 1 ? [...prev, ...data.results] : data.results);
    setMeta(data.meta || null);
    setLoading(false);
  });

  const search = useCallback((q, pg = 1) => {
    const trimmed = (q ?? query).trim();
    if (!trimmed) { setResults([]); setMeta(null); return; }
    const id = ++searchIdRef.current;
    setLoading(true);
    setPage(pg);
    if (pg === 1) setResults([]);
    socket.emit('search', { query: trimmed, page: pg, _searchId: id, language: localStorage.getItem('scicp_language') || 'en' });
  }, [query]);

  const loadMore = useCallback(() => {
    if (loading || !meta?.hasMore) return;
    search(query, page + 1);
  }, [loading, meta, query, page, search]);

  const clear = useCallback(() => {
    setQuery('');
    setResults([]);
    setMeta(null);
    setPage(1);
  }, []);

  return { query, setQuery, results, meta, loading, search, loadMore, clear };
}
