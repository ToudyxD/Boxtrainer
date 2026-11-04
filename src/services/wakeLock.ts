/** Hält den Bildschirm wach und fordert die Sperre nach Rückkehr in den Vordergrund neu an. */
export class WakeLockService {
  private sentinel: WakeLockSentinel | undefined;
  private wanted = false;
  private readonly onVisible = (): void => {
    if (this.wanted && document.visibilityState === "visible" && !this.sentinel) void this.request().catch(() => undefined);
  };

  get supported(): boolean {
    return "wakeLock" in navigator;
  }

  async acquire(): Promise<void> {
    if (!this.supported) throw new Error("Wake Lock wird von diesem Browser nicht unterstützt");
    this.wanted = true;
    document.addEventListener("visibilitychange", this.onVisible);
    await this.request();
  }

  async release(): Promise<void> {
    this.wanted = false;
    document.removeEventListener("visibilitychange", this.onVisible);
    const sentinel = this.sentinel;
    this.sentinel = undefined;
    await sentinel?.release();
  }

  private async request(): Promise<void> {
    const sentinel = await navigator.wakeLock.request("screen");
    sentinel.addEventListener("release", () => {
      if (this.sentinel === sentinel) this.sentinel = undefined;
    });
    this.sentinel = sentinel;
  }
}
