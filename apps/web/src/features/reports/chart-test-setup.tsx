import { cloneElement, type ReactElement } from 'react';

/**
 * Test-only: jsdom lays nothing out, so recharts' `ResponsiveContainer` measures 0x0 and logs a size warning. This
 * stand-in gives its chart a fixed size. Use as `vi.mock('recharts', async (orig) => fixedSizeCharts(await orig()))`.
 */
export function fixedSizeCharts<T extends object>(recharts: T): T {
  return {
    ...recharts,
    ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) => cloneElement(children, { width: 600, height: 240 }),
  };
}
