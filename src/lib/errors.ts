/** Shared typed errors — routes map NotFoundError → 404, IneligibleError → 409. */
export class NotFoundError extends Error {}
export class IneligibleError extends Error {}
