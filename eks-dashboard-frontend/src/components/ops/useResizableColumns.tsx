import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export const useResizableColumns = <Key extends string>(
  defaultWidths: Record<Key, number>,
  minWidths: Record<Key, number>,
) => {
  const [columnWidths, setColumnWidths] = useState<Record<Key, number>>(defaultWidths);
  const cleanupRef = useRef<() => void>(() => undefined);

  useEffect(() => () => cleanupRef.current(), []);

  const renderResizableTitle = useCallback((key: Key, title: ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', userSelect: 'none' }}>
      <span>{title}</span>
      <span
        title="拖拽调整列宽"
        aria-label={`调整${String(title)}列宽`}
        role="separator"
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          cleanupRef.current();
          const startX = event.clientX;
          const startWidth = columnWidths[key];
          const onMouseMove = (moveEvent: MouseEvent) => {
            const nextWidth = Math.max(minWidths[key], startWidth + moveEvent.clientX - startX);
            setColumnWidths((current) => ({ ...current, [key]: nextWidth }));
          };
          const onMouseUp = () => cleanupRef.current();
          cleanupRef.current = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            cleanupRef.current = () => undefined;
          };
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
        }}
        style={{ cursor: 'col-resize', display: 'inline-block', height: 18, marginLeft: 8, width: 8, borderRight: '2px solid #d9d9d9' }}
      />
    </div>
  ), [columnWidths, minWidths]);

  return { columnWidths, renderResizableTitle };
};
