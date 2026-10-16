/** Tracks asynchronous picker work across composer/conversation resets. */
export class AttachmentPreparation {
  private generation = 0;
  private pending = 0;

  constructor(private changed: (loading: boolean) => void) {}

  get loading(): boolean { return this.pending > 0; }

  begin(): { current: () => boolean; commit: (apply: () => void) => boolean; finish: () => void } {
    const generation = this.generation;
    let finished = false;
    this.pending++;
    this.changed(true);
    const current = () => generation === this.generation && !finished;
    return {
      current,
      commit: apply => { if (!current()) return false; apply(); return true; },
      finish: () => {
        if (finished) return;
        finished = true;
        if (generation !== this.generation) return;
        this.pending--;
        this.changed(this.loading);
      },
    };
  }

  cancel(): void {
    this.generation++;
    this.pending = 0;
    this.changed(false);
  }
}
