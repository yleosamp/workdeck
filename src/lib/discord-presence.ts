import { invoke } from "@tauri-apps/api/core";

export type DiscordPresenceSettings = {
  enabled: boolean;
  clientId: string;
  showCurrentApp: boolean;
  showSessionTime: boolean;
  showTotalTime: boolean;
  showAppIcon: boolean;
};

export type DiscordPresenceView = {
  settings: DiscordPresenceSettings;
  connected: boolean;
  lastError: string | null;
};

export const defaultDiscordPresenceSettings: DiscordPresenceSettings = {
  enabled: true,
  clientId: "",
  showCurrentApp: true,
  showSessionTime: true,
  showTotalTime: true,
  showAppIcon: true
};

const browserKey = "workdeck.discord-presence";

function isTauri() {
  return "__TAURI_INTERNALS__" in window;
}

function browserView(): DiscordPresenceView {
  try {
    const settings = { ...defaultDiscordPresenceSettings, ...JSON.parse(localStorage.getItem(browserKey) ?? "{}") };
    return { settings, connected: false, lastError: settings.clientId ? "Abra o aplicativo instalado para conectar ao Discord." : null };
  } catch {
    return { settings: defaultDiscordPresenceSettings, connected: false, lastError: null };
  }
}

export async function getDiscordPresence(): Promise<DiscordPresenceView> {
  if (!isTauri()) return browserView();
  return invoke<DiscordPresenceView>("get_discord_presence_settings");
}

export async function saveDiscordPresence(settings: DiscordPresenceSettings): Promise<DiscordPresenceView> {
  if (!isTauri()) {
    localStorage.setItem(browserKey, JSON.stringify(settings));
    return browserView();
  }
  return invoke<DiscordPresenceView>("set_discord_presence_settings", { settings });
}

export async function refreshDiscordPresence(): Promise<DiscordPresenceView> {
  if (!isTauri()) return browserView();
  return invoke<DiscordPresenceView>("refresh_discord_presence");
}
