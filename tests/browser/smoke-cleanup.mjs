/** Run every release-smoke cleanup without masking the failure from its body. */
export async function runBestEffortCleanup(cleanups) {
  for (const cleanup of cleanups) {
    try {
      await cleanup()
    } catch {
      // Cleanup is independent and best-effort; later resources still need a turn.
    }
  }
}
