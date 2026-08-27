import { invoke } from "@tauri-apps/api/core";

export function notificationsEnabled() {
  return localStorage.getItem("workdeck.notifications") !== "false";
}

export async function notifySoftwareStarted(friendId: string, displayName: string, softwareName: string) {
  if (!notificationsEnabled()) return;
  if ("__TAURI_INTERNALS__" in window) {
    await invoke("show_friend_notification", { friendId, displayName, softwareName });
  }
}
