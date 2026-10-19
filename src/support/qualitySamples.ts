// Collects the per-second network samples the Twilio SDK emits during a call
// and reduces them to one summary every few seconds, so the server stores a
// handful of rows per call instead of one per second.
//
// Pure: no browser or SDK imports, so it is covered by the Node tests.
//
// PArAsYtE | RA-Workspace support module

export type RawSample = { rtt?: number; jitter?: number; packetsLostFraction?: number }
export type QualitySummary = { rttMs: number; jitterMs: number; lossPct: number; count: number }

export class QualityAccumulator {
  private rtt = 0
  private jitter = 0
  private loss = 0
  private n = 0

  /** Twilio reports rtt and jitter in milliseconds and loss as a 0..1 fraction (some builds report 0..100). */
  add(sample: RawSample) {
    const rtt = Number(sample.rtt)
    const jitter = Number(sample.jitter)
    let loss = Number(sample.packetsLostFraction)
    if (!Number.isFinite(rtt) && !Number.isFinite(jitter) && !Number.isFinite(loss)) return
    if (Number.isFinite(loss) && loss <= 1) loss *= 100
    this.rtt += Number.isFinite(rtt) ? Math.max(0, rtt) : 0
    this.jitter += Number.isFinite(jitter) ? Math.max(0, jitter) : 0
    this.loss += Number.isFinite(loss) ? Math.min(100, Math.max(0, loss)) : 0
    this.n++
  }

  get size() { return this.n }

  /** Average of everything since the last flush, then reset. Null when there is nothing to report. */
  flush(): QualitySummary | null {
    if (this.n === 0) return null
    const out = {
      rttMs: Math.round((this.rtt / this.n) * 10) / 10,
      jitterMs: Math.round((this.jitter / this.n) * 10) / 10,
      lossPct: Math.round((this.loss / this.n) * 100) / 100,
      count: this.n,
    }
    this.rtt = this.jitter = this.loss = 0
    this.n = 0
    return out
  }
}
