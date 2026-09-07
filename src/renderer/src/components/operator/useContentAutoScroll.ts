import { useLayoutEffect, useRef } from 'react';

/** Follow new content once; leave manual scrolling and resizing alone. */
export function useContentAutoScroll(edge: 'top' | 'bottom', contentVersion: string | number) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.scrollTop = edge === 'top' ? 0 : element.scrollHeight;
  }, [edge, contentVersion]);
  return ref;
}
