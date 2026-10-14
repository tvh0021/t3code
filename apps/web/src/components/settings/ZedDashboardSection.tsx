import { useState } from "react";

import { Button } from "../ui/button";
import { SettingsRow } from "./settingsLayout";

/**
 * Desktop-only sign-in that stores Zed's dashboard session for account spend.
 * Other clients paste the session into the Dashboard session field instead.
 */
export function ZedDashboardSection({
  connected,
  onConnect,
}: {
  readonly connected: boolean;
  readonly onConnect: (dashboardSession: string) => Promise<void>;
}) {
  const connect = window.desktopBridge?.connectZedDashboard;
  const [busy, setBusy] = useState(false);
  if (!connect) return null;
  return (
    <SettingsRow
      title="Zed dashboard"
      description={
        connected
          ? "Connected. Account spend refreshes after each Zed turn."
          : "Sign in to show your Zed account spend in Limits."
      }
      control={
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void connect()
              .then((session) => (session ? onConnect(session) : undefined))
              .finally(() => setBusy(false));
          }}
        >
          {connected ? "Reconnect" : "Connect"}
        </Button>
      }
    />
  );
}
