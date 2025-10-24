import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let errorMessage = res.statusText;
    try {
      // Clone the response so we don't consume the original body
      const clonedResponse = res.clone();
      const text = await clonedResponse.text();
      if (text) {
        errorMessage = text;
      }
    } catch (e) {
      // If we can't read the response body, just use statusText
    }
    throw new Error(`${res.status}: ${errorMessage}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

// Offline persistence helpers
const CACHE_KEY = 'tanstack-query-cache';
const CACHE_VERSION = 'v1';

export function persistQueryCache(queryClient: QueryClient) {
  try {
    const cache = queryClient.getQueryCache();
    const queries = cache.getAll();
    const serializedData = queries.map(query => ({
      queryKey: query.queryKey,
      queryHash: query.queryHash,
      state: query.state,
    }));
    
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      version: CACHE_VERSION,
      timestamp: Date.now(),
      queries: serializedData,
    }));
  } catch (error) {
    console.error('Failed to persist query cache:', error);
  }
}

export function restoreQueryCache(queryClient: QueryClient) {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return;
    
    const { version, timestamp, queries } = JSON.parse(cached);
    
    // Check version and age (24 hours)
    if (version !== CACHE_VERSION || Date.now() - timestamp > 86400000) {
      localStorage.removeItem(CACHE_KEY);
      return;
    }
    
    queries.forEach((query: any) => {
      queryClient.setQueryData(query.queryKey, query.state.data);
    });
  } catch (error) {
    console.error('Failed to restore query cache:', error);
  }
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
      gcTime: 1000 * 60 * 60 * 24, // 24 hours
    },
    mutations: {
      retry: false,
    },
  },
});

// Set up automatic cache persistence
if (typeof window !== 'undefined') {
  // Restore cache on load
  restoreQueryCache(queryClient);
  
  // Persist cache on changes
  queryClient.getQueryCache().subscribe(() => {
    persistQueryCache(queryClient);
  });
  
  // Persist before page unload
  window.addEventListener('beforeunload', () => {
    persistQueryCache(queryClient);
  });
}
