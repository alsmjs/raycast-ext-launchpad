import { startLaunchpad } from "./store";
import { TopGrid } from "./ui/TopGrid";

/**
 * Command entry point.
 *
 * The load is kicked off at module scope rather than from an effect so the
 * LocalStorage read is already in flight before React's first render — there is
 * nothing to wait for and no reason to spend a frame on it. `startLaunchpad` is
 * idempotent.
 */
startLaunchpad();

export default function Launchpad() {
  return <TopGrid />;
}
