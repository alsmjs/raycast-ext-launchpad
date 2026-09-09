// Raycast's bundler does not polyfill a global `crypto`, so the explicit import
// is required — `crypto.randomUUID()` alone throws at runtime. Centralized here
// so the gotcha only has to be remembered once.
import crypto from "crypto";

export function newId(): string {
  return crypto.randomUUID();
}
