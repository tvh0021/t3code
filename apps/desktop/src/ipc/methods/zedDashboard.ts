import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { connectZedDashboard as signIn } from "../../app/ZedDashboardSignIn.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as IpcChannels from "../channels.ts";

export const connectZedDashboard = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.CONNECT_ZED_DASHBOARD_CHANNEL,
  payload: Schema.Void,
  result: Schema.NullOr(Schema.String),
  handler: () => Effect.promise(signIn),
});
