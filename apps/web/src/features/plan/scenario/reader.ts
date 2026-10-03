// One read belongs to one board/account/input identity. Abort is also checked after settlement: a transport may
// answer despite cancellation. No late value or late error may enter a different board.
export class ScenarioReader<T> {
  private identity: string | null = null;
  private controller: AbortController | null = null;
  invalidate(identity: string | null) {
    this.identity = identity;
    this.controller?.abort();
    this.controller = null;
  }
  async run(identity: string, load: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    if (identity !== this.identity) return undefined;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const current = () => !controller.signal.aborted && this.controller === controller && this.identity === identity;
    try {
      const result = await load(controller.signal);
      return current() ? result : undefined;
    } catch (error) {
      if (current()) throw error;
      return undefined;
    }
  }
}
