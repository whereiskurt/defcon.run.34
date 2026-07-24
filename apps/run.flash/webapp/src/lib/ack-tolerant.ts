/**
 * Ack-tolerant admin-write awaiting.
 *
 * Firmware 2.8 develop never delivers local admin ACKs: the self-routed ACK
 * packet is dropped by MeshModule's loopbackOk gate before the phone-forward
 * step (upstream regression, verified against meshtasticd 2.8.0 develop —
 * the WRITES still apply, only the ACK dies). On ≤2.7 firmware ACKs arrive in
 * well under a second. The post-commit read-back (verify-config.ts /
 * verifyRegion) remains the real integrity gate either way.
 *
 * Kept OUT of lib/meshtastic.ts (a "use client" module that imports the
 * web-serial transport) so this stays pure + unit-testable in Node.
 */

/** Max time to wait for an admin-write ACK before continuing (ms). */
export const ADMIN_ACK_TIMEOUT_MS = 3000;

/**
 * Await an admin-write promise, tolerating a missing ACK.
 *
 * Resolves when the write is ACKed OR after `timeoutMs`, whichever comes
 * first. The underlying library promise keeps its own 60s timer; its eventual
 * TIMEOUT rejection is swallowed so it can never become an unhandled
 * rejection. Packet ordering is unaffected — the library writes each packet
 * to the transport synchronously at call time; only the ACK wait is raced.
 */
export async function awaitAckTolerant(
  promise: Promise<unknown>,
  label: string,
  timeoutMs: number = ADMIN_ACK_TIMEOUT_MS
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tolerated = promise.then(
    () => true,
    (err) => {
      console.warn(
        `[meshtastic] ${label}: ack wait ended with error (tolerated):`,
        err
      );
      return false;
    }
  );
  const acked = await Promise.race([
    tolerated,
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  if (!acked) {
    console.warn(
      `[meshtastic] ${label}: no ack within ${timeoutMs}ms — continuing ` +
        `(2.8 develop firmware drops local admin acks; read-back verification is the gate)`
    );
  }
}
