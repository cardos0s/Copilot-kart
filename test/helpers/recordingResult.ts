/**
 * O que o `stop()` do hook de gravação devolve para os frames dados: os frames
 * de análise, as janelas (`sliceLapWindows(analysisGps(…))`) e as voltas
 * montadas por `recordedLaps` (frames de cada janela pelo `lapFrames`).
 */
import { recordedLaps } from '../../src/recording/finishSession';
import { recordingSeries } from '../../src/recording/journal';
import type { StartLine } from '../../src/lib/startLine';
import type { GpsFrame, ImuFrame } from '../../src/telemetry/frame';
import { analysisGps, sliceLapWindows } from '../../src/telemetry/laps';
import { gpsSeriesOf, imuSeriesOf } from '../../src/telemetry/series';

export function stopResult(gps: GpsFrame[], imu: ImuFrame[], t0Utc: number, line: StartLine | null = null) {
  const windows = sliceLapWindows(analysisGps(gps), line);
  const series = recordingSeries('result', t0Utc);
  return {
    t0Utc,
    gps,
    imu,
    windows,
    allSamples: analysisGps(gps),
    laps: recordedLaps(windows, gpsSeriesOf(series.gps, gps), imuSeriesOf(series.imu, imu), t0Utc),
  };
}
