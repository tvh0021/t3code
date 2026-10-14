import * as Electron from "electron";

const ZED_CLOUD_URL = "https://cloud.zed.dev";
const SIGN_IN_URL = `${ZED_CLOUD_URL}/frontend/auth/sign_in?next=/`;
// Kept apart from preview partitions so the user's browsing never shares this sign-in.
const PARTITION = "persist:t3code-zed-dashboard";

let pending: {
  readonly window: Electron.BrowserWindow;
  readonly result: Promise<string | null>;
} | null = null;

/** The Cookie header cloud.zed.dev accepts from this session, or null when signed out. */
async function readSignedInCookie(session: Electron.Session): Promise<string | null> {
  try {
    const cookies = await session.cookies.get({ url: ZED_CLOUD_URL });
    if (cookies.length === 0) return null;
    // The session's own cookie jar answers whether the header below is signed in.
    const response = await session.fetch(`${ZED_CLOUD_URL}/frontend/session`, {
      headers: { Accept: "application/json" },
      credentials: "include",
      redirect: "manual",
    });
    await response.body?.cancel();
    if (!response.ok) return null;
    return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  } catch {
    return null;
  }
}

function isBackOnZed(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    return (
      (hostname === "zed.dev" || hostname.endsWith(".zed.dev")) &&
      !pathname.startsWith("/frontend/auth")
    );
  } catch {
    return false;
  }
}

/**
 * Signs in to Zed's dashboard in a dedicated window and resolves with the
 * cloud.zed.dev Cookie header, or null when the user closes the window first.
 * A still-valid earlier sign-in resolves without opening a window.
 */
export async function connectZedDashboard(): Promise<string | null> {
  if (pending && !pending.window.isDestroyed()) {
    pending.window.focus();
    return pending.result;
  }
  const session = Electron.session.fromPartition(PARTITION);
  const existing = await readSignedInCookie(session);
  if (existing) return existing;

  const window = new Electron.BrowserWindow({
    width: 520,
    height: 760,
    title: "Connect Zed dashboard",
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  const result = new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (cookie: string | null) => {
      if (settled) return;
      settled = true;
      resolve(cookie);
      if (!window.isDestroyed()) window.close();
    };
    const check = (_event: unknown, url: string) => {
      if (!isBackOnZed(url)) return;
      void readSignedInCookie(session).then((cookie) => {
        if (cookie) finish(cookie);
      });
    };
    window.webContents.on("did-navigate", check);
    window.webContents.on("did-navigate-in-page", check);
    window.on("closed", () => {
      pending = null;
      finish(null);
    });
  });
  pending = { window, result };
  // Redirect chains abort the initial load; navigation events still report the outcome.
  window.loadURL(SIGN_IN_URL).catch(() => undefined);
  return result;
}
