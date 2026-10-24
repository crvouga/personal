import type { HeartbeatPoint } from '../types';
import { bucketize } from '../ui/lib/series';

export interface ChartPoint {
  time: string;
  load: number | null;
  memory: number | null;
  disk: number | null;
  busy: number | null;
}
export function chartData(
  points: readonly HeartbeatPoint[],
  now: Date
): ChartPoint[] {
  const load = bucketize(points, (point) => point.load1, now);
  const memory = bucketize(points, (point) => point.memUsedPercent, now);
  const disk = bucketize(points, (point) => point.diskPercent, now);
  const busy = bucketize(points, (point) => point.busySlots, now);
  return load.map((bucket, index) => ({
    time: new Date(bucket.start).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    }),
    load: bucket.value,
    memory: memory[index]?.value ?? null,
    disk: disk[index]?.value ?? null,
    busy: busy[index]?.value ?? null,
  }));
}
