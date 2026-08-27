function safeFileName(name: string) {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 220) || "arquivo-recebido";
}

export type SavedFile = { saved: boolean; path?: string };

export async function saveReceivedFile(name: string, blob: Blob): Promise<SavedFile> {
  const fileName = safeFileName(name);
  if ("__TAURI_INTERNALS__" in window) {
    const [{ save }, { writeFile }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/plugin-fs")
    ]);
    const extension = fileName.includes(".") ? fileName.split(".").pop() : undefined;
    const path = await save({
      title: "Salvar arquivo recebido",
      defaultPath: fileName,
      filters: extension ? [{ name: "Arquivo recebido", extensions: [extension] }] : undefined
    });
    if (!path) return { saved: false };
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    return { saved: true, path };
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { saved: true };
}

export async function openSavedFile(path: string) {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const { openPath } = await import("@tauri-apps/plugin-opener");
  await openPath(path);
}

export async function revealSavedFile(path: string) {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(path);
}
