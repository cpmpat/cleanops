// backend/src/jobs/pms-sync-lock.ts
//
// One writer at a time for Avantio → bookings → turnovers. The 30-minute sync
// and the nightly sweep both insert bookings and thread turnovers; two of them
// working the same booking at once can each decide the chain needs a new row.
//
// Process-local: correct while the API runs as a single Railway instance. With
// more than one replica this needs a database advisory lock instead.

let holder: string | null = null;

export const pmsSyncLock = {
  tryAcquire(name: string): boolean {
    if (holder) return false;
    holder = name;
    return true;
  },
  release(name: string): void {
    if (holder === name) holder = null;
  },
  get holder(): string | null {
    return holder;
  },
};
