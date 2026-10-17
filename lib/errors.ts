// Errors shared by lib/scoped-db.ts and lib/api.ts, kept apart so neither pulls in the other.

/** Thrown when a suspended school tries to create or change something. Looking is still allowed. */
export class SchoolSuspendedError extends Error {
  constructor() {
    super('Your school’s subscription is suspended. You can look at records but not change them.');
    this.name = 'SchoolSuspendedError';
  }
}
