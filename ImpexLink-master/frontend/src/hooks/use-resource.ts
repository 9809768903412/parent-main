import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/api/client';
import { getCacheEntry, getCache, setCache } from '@/hooks/cache';

export function useResource<T>(
  path: string,
  fallback: T,
  deps: unknown[] = [],
  staleTimeMs = 15_000,
  params?: Record<string, any>
) {
  const key = params ? `${path}?${new URLSearchParams(params as Record<string, string>).toString()}` : path;
  const cachedEntry = getCacheEntry<T>(key);
  const cached = getCache<T>(key, staleTimeMs);
  const [data, setData] = useState<T>(cached ?? fallback);
  const [loading, setLoading] = useState<boolean>(!cached);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(cachedEntry?.ts || null);

  const fetchData = useCallback(async (force = false) => {
    const useMocks = import.meta.env.VITE_USE_MOCKS === 'true';
    if (useMocks) {
      setData(fallback);
      setLoading(false);
      setLastUpdated(Date.now());
      return;
    }

    if (!force && getCache<T>(key, staleTimeMs)) {
      setLoading(false);
      return;
    }

    setLoading((prev) => (cached ? prev : true));
    setError(null);
    try {
      const response = await apiClient.get<T>(path, { params });
      setData(response.data);
      setCache(key, response.data);
      setLastUpdated(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [fallback, path, staleTimeMs, cached, key, params]);

  useEffect(() => {
    fetchData();
  }, [fetchData, ...deps]);

  return {
    data,
    setData,
    loading,
    error,
    lastUpdated,
    reload: () => fetchData(true),
  };
}
