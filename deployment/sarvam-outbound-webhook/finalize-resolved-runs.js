// Compatibility entry point for existing runbooks. The installed canonical
// command retains dry-run by default and only applies with the same --apply flag.
console.log("Deprecated entry point: delegating to audited Run lifecycle reconciliation.");
await import("./reconcile-open-runs.js");
