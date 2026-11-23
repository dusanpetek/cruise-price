export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}

export class SnapshotExistsError extends Error {
  constructor(id: string) {
    super(`Snapshot ${id} already exists; snapshots are immutable`);
    this.name = 'SnapshotExistsError';
  }
}

export class CorruptSnapshotError extends Error {
  constructor(file: string, reason: string) {
    super(`Corrupt snapshot ${file}: ${reason}`);
    this.name = 'CorruptSnapshotError';
  }
}

export class CollectorLockedError extends Error {
  constructor(public readonly holder: { pid: number; startedAt: string }) {
    super(`A collection is already running (pid ${holder.pid}, since ${holder.startedAt})`);
    this.name = 'CollectorLockedError';
  }
}
