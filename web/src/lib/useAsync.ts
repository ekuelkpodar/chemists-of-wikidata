import { useCallback, useEffect, useState } from 'react'

export interface Async<T> { data: T | null; error: Error | null; loading: boolean; retry: () => void }

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): Async<T> {
  const [state, set] = useState<{ data: T | null; error: Error | null; loading: boolean }>({ data: null, error: null, loading: true })
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let live = true
    set((s) => ({ ...s, loading: true, error: null }))
    fn().then((data) => live && set({ data, error: null, loading: false }))
      .catch((error: Error) => live && set({ data: null, error, loading: false }))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])
  const retry = useCallback(() => setNonce((n) => n + 1), [])
  return { ...state, retry }
}

export function useSize<T extends HTMLElement>(): [(el: T | null) => void, { width: number; height: number }] {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [el, setEl] = useState<T | null>(null)
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ width: e.contentRect.width, height: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, size]
}
