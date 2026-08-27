use chrono::{Duration, Local};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::{collections::HashSet, fs, sync::Mutex, thread, time::{Duration as StdDuration, Instant}};
use sysinfo::System;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_updater::UpdaterExt;

struct Tracker {
    database: Mutex<Connection>,
    last_sync: Mutex<Instant>,
}

#[derive(Serialize)]
struct TrackedApp {
    id: String,
    name: String,
    category: String,
    color: String,
    process_names: Vec<String>,
    total_seconds: i64,
    today_seconds: i64,
    last_opened: Option<String>,
    is_running: bool,
}

#[derive(Serialize)]
struct HeatmapDay {
    date: String,
    seconds: i64,
}

#[derive(Serialize)]
struct AppActivityDay {
    date: String,
    app_id: String,
    seconds: i64,
}

#[derive(Serialize)]
struct ActivitySnapshot {
    apps: Vec<TrackedApp>,
    heatmap: Vec<HeatmapDay>,
    app_daily: Vec<AppActivityDay>,
    tracked_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AvailableUpdate {
    version: String,
    current_version: String,
    notes: Option<String>,
    published_at: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateProgress {
    downloaded: u64,
    total: Option<u64>,
    percent: Option<u8>,
    finished: bool,
}

fn initialize_database(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         CREATE TABLE IF NOT EXISTS app_catalog (
           id TEXT PRIMARY KEY,
           name TEXT NOT NULL,
           category TEXT NOT NULL,
           color TEXT NOT NULL,
           process_names TEXT NOT NULL,
           created_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS app_totals (
           app_id TEXT PRIMARY KEY REFERENCES app_catalog(id),
           total_seconds INTEGER NOT NULL DEFAULT 0,
           last_opened TEXT
         );
         CREATE TABLE IF NOT EXISTS daily_activity (
           date TEXT NOT NULL,
           app_id TEXT NOT NULL REFERENCES app_catalog(id),
           seconds INTEGER NOT NULL DEFAULT 0,
           PRIMARY KEY (date, app_id)
         );
         CREATE INDEX IF NOT EXISTS idx_daily_activity_date ON daily_activity(date);"
    )?;

    let builtins = [
        ("after-effects", "After Effects", "Motion design", "#9999ff", r#"["AfterFX.exe","AfterFX","After Effects","Adobe After Effects*"]"#),
        ("premiere-pro", "Premiere Pro", "Video editing", "#9999ff", r#"["Adobe Premiere Pro.exe","Adobe Premiere Pro","Adobe Premiere Pro*"]"#),
        ("blender", "Blender", "3D creation", "#f5792a", r#"["blender.exe","blender","Blender"]"#),
        ("photoshop", "Photoshop", "Image editing", "#31a8ff", r#"["Photoshop.exe","Photoshop","Adobe Photoshop*"]"#),
        ("figma", "Figma", "Interface design", "#a259ff", r#"["Figma.exe","Figma"]"#),
    ];

    for (id, name, category, color, process_names) in builtins {
        connection.execute(
            "INSERT INTO app_catalog (id, name, category, color, process_names, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
               name=excluded.name,
               category=excluded.category,
               color=excluded.color,
               process_names=excluded.process_names",
            params![id, name, category, color, process_names, Local::now().to_rfc3339()],
        )?;
        connection.execute(
            "INSERT OR IGNORE INTO app_totals (app_id, total_seconds) VALUES (?1, 0)",
            params![id],
        )?;
    }
    Ok(())
}

fn slugify(value: &str) -> String {
    let mut output = String::new();
    let mut last_was_dash = false;
    for character in value.to_lowercase().chars() {
        if character.is_ascii_alphanumeric() {
            output.push(character);
            last_was_dash = false;
        } else if !last_was_dash && !output.is_empty() {
            output.push('-');
            last_was_dash = true;
        }
    }
    output.trim_end_matches('-').to_string()
}

#[tauri::command]
fn add_tracked_app(
    name: String,
    process_names: Vec<String>,
    color: String,
    tracker: State<'_, Tracker>,
) -> Result<(), String> {
    if name.trim().is_empty() || process_names.is_empty() {
        return Err("A name and at least one process are required".into());
    }
    let id = slugify(&name);
    let process_json = serde_json::to_string(&process_names).map_err(|error| error.to_string())?;
    let connection = tracker.database.lock().map_err(|error| error.to_string())?;
    connection.execute(
        "INSERT INTO app_catalog (id, name, category, color, process_names, created_at)
         VALUES (?1, ?2, 'Custom software', ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, color=excluded.color, process_names=excluded.process_names",
        params![id, name.trim(), color, process_json, Local::now().to_rfc3339()],
    ).map_err(|error| error.to_string())?;
    connection.execute(
        "INSERT OR IGNORE INTO app_totals (app_id, total_seconds) VALUES (?1, 0)",
        params![id],
    ).map_err(|error| error.to_string())?;
    Ok(())
}

fn collect_activity(tracker: &Tracker) -> Result<ActivitySnapshot, String> {
    let mut system = System::new_all();
    system.refresh_all();
    let running_processes: HashSet<String> = system
        .processes()
        .values()
        .map(|process| process.name().to_string_lossy().to_lowercase())
        .collect();

    let elapsed_seconds = {
        let mut last_sync = tracker.last_sync.lock().map_err(|error| error.to_string())?;
        let seconds = last_sync.elapsed().as_secs().min(60) as i64;
        *last_sync = Instant::now();
        seconds
    };

    let today = Local::now().format("%Y-%m-%d").to_string();
    let now = Local::now().to_rfc3339();
    let mut connection = tracker.database.lock().map_err(|error| error.to_string())?;

    let catalog: Vec<(String, String, String, String, Vec<String>)> = {
        let mut statement = connection
            .prepare("SELECT id, name, category, color, process_names FROM app_catalog ORDER BY created_at")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                let raw: String = row.get(4)?;
                let process_names = serde_json::from_str(&raw).unwrap_or_default();
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, process_names))
            })
            .map_err(|error| error.to_string())?
            .filter_map(Result::ok)
            .collect();
        rows
    };

    let running_ids: HashSet<String> = catalog
        .iter()
        .filter(|(_, _, _, _, process_names)| {
            process_names.iter().any(|candidate| {
                let candidate = candidate.trim().to_lowercase();
                if let Some(prefix) = candidate.strip_suffix('*') {
                    running_processes.iter().any(|process| process.starts_with(prefix))
                } else {
                    running_processes.contains(&candidate)
                }
            })
        })
        .map(|(id, _, _, _, _)| id.clone())
        .collect();

    if elapsed_seconds > 0 && !running_ids.is_empty() {
        let transaction = connection.transaction().map_err(|error| error.to_string())?;
        for id in &running_ids {
            transaction.execute(
                "INSERT INTO daily_activity (date, app_id, seconds) VALUES (?1, ?2, ?3)
                 ON CONFLICT(date, app_id) DO UPDATE SET seconds = seconds + excluded.seconds",
                params![today, id, elapsed_seconds],
            ).map_err(|error| error.to_string())?;
            transaction.execute(
                "INSERT INTO app_totals (app_id, total_seconds, last_opened) VALUES (?1, ?2, ?3)
                 ON CONFLICT(app_id) DO UPDATE SET total_seconds = total_seconds + excluded.total_seconds, last_opened = excluded.last_opened",
                params![id, elapsed_seconds, now],
            ).map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())?;
    }

    let mut apps = Vec::with_capacity(catalog.len());
    for (id, name, category, color, process_names) in catalog {
        let (total_seconds, last_opened): (i64, Option<String>) = connection
            .query_row(
                "SELECT total_seconds, last_opened FROM app_totals WHERE app_id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap_or((0, None));
        let today_seconds = connection
            .query_row(
                "SELECT seconds FROM daily_activity WHERE date = ?1 AND app_id = ?2",
                params![today, id],
                |row| row.get(0),
            )
            .unwrap_or(0);
        apps.push(TrackedApp {
            is_running: running_ids.contains(&id),
            id,
            name,
            category,
            color,
            process_names,
            total_seconds,
            today_seconds,
            last_opened,
        });
    }

    let start_date = Local::now().date_naive() - Duration::days(363);
    let mut heatmap = Vec::with_capacity(364);
    for offset in 0..364 {
        let date = (start_date + Duration::days(offset)).format("%Y-%m-%d").to_string();
        let seconds = connection
            .query_row(
                "SELECT COALESCE(SUM(seconds), 0) FROM daily_activity WHERE date = ?1",
                params![date],
                |row| row.get(0),
            )
            .unwrap_or(0);
        heatmap.push(HeatmapDay { date, seconds });
    }

    let app_daily = {
        let mut statement = connection
            .prepare(
                "SELECT date, app_id, seconds FROM daily_activity
                 WHERE date >= ?1 ORDER BY date, app_id",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![start_date.format("%Y-%m-%d").to_string()], |row| {
                Ok(AppActivityDay {
                    date: row.get(0)?,
                    app_id: row.get(1)?,
                    seconds: row.get(2)?,
                })
            })
            .map_err(|error| error.to_string())?
            .filter_map(Result::ok)
            .collect();
        rows
    };

    Ok(ActivitySnapshot { apps, heatmap, app_daily, tracked_at: now })
}

#[tauri::command]
fn sync_activity(tracker: State<'_, Tracker>) -> Result<ActivitySnapshot, String> {
    collect_activity(&tracker)
}

fn encode_query(value: &str) -> String {
    value.bytes().map(|byte| match byte {
        b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (byte as char).to_string(),
        _ => format!("%{byte:02X}"),
    }).collect()
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_skip_taskbar(false);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn update_endpoint(api_url: &str) -> Result<tauri::Url, String> {
    let base = api_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("Configure o endereço do servidor antes de procurar atualizações".into());
    }
    tauri::Url::parse(&format!(
        "{base}/updates/{{{{target}}}}/{{{{arch}}}}/{{{{current_version}}}}"
    ))
    .map_err(|_| "O endereço do servidor de atualizações é inválido".to_string())
}

async fn find_update(app: &AppHandle, api_url: &str) -> Result<Option<tauri_plugin_updater::Update>, String> {
    let endpoint = update_endpoint(api_url)?;
    app.updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn check_for_update(app: AppHandle, api_url: String) -> Result<Option<AvailableUpdate>, String> {
    Ok(find_update(&app, &api_url).await?.map(|update| AvailableUpdate {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone(),
        published_at: update.date.map(|date| date.to_string()),
    }))
}

#[tauri::command]
async fn install_update(app: AppHandle, api_url: String) -> Result<(), String> {
    let Some(update) = find_update(&app, &api_url).await? else {
        return Err("Esta instalação já está atualizada".into());
    };
    let progress_app = app.clone();
    let finished_app = app.clone();
    let mut downloaded = 0_u64;
    update
        .download_and_install(
            move |chunk_length, content_length| {
                downloaded += chunk_length as u64;
                let percent = content_length
                    .filter(|total| *total > 0)
                    .map(|total| ((downloaded.saturating_mul(100) / total).min(100)) as u8);
                let _ = progress_app.emit(
                    "update-progress",
                    UpdateProgress { downloaded, total: content_length, percent, finished: false },
                );
            },
            move || {
                let _ = finished_app.emit(
                    "update-progress",
                    UpdateProgress { downloaded: 0, total: None, percent: Some(100), finished: true },
                );
            },
        )
        .await
        .map_err(|error| error.to_string())?;

    #[cfg(not(target_os = "windows"))]
    app.request_restart();

    Ok(())
}

#[tauri::command]
async fn show_friend_notification(app: AppHandle, friend_id: String, display_name: String, software_name: String) -> Result<(), String> {
    let active_notices = app.webview_windows().keys().filter(|label| label.starts_with("friend-activity-")).count() as i32;
    let label = format!("friend-activity-{}", chrono::Utc::now().timestamp_millis());
    let url = format!(
        "index.html?friendActivity=1&friendId={}&displayName={}&softwareName={}",
        encode_query(&friend_id),
        encode_query(&display_name),
        encode_query(&software_name)
    );
    let monitor = app.get_webview_window("main")
        .and_then(|window| window.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let notice = WebviewWindowBuilder::new(&app, label, WebviewUrl::App(url.into()))
        .title("Atividade de amigo")
        .inner_size(340.0, 88.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .focusable(true)
        .shadow(true)
        .build()
        .map_err(|error| error.to_string())?;
    if let Some(monitor) = monitor {
        let scale = monitor.scale_factor();
        let width = (340.0 * scale).round() as i32;
        let height = (88.0 * scale).round() as i32;
        let gap = (10.0 * scale).round() as i32;
        let edge = (18.0 * scale).round() as i32;
        let work_area = monitor.work_area();
        let x = work_area.position.x + work_area.size.width as i32 - width - edge;
        let y = work_area.position.y + work_area.size.height as i32 - height - edge - active_notices * (height + gap);
        let _ = notice.set_position(PhysicalPosition::new(x, y));
    }
    Ok(())
}

#[tauri::command]
fn open_friend_chat(app: AppHandle, friend_id: String) -> Result<(), String> {
    show_main_window(&app);
    if !friend_id.is_empty() {
        if let Some(window) = app.get_webview_window("main") {
            window.emit("open-friend-chat", friend_id).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&data_dir)?;
            let connection = Connection::open(data_dir.join("workdeck.db"))?;
            initialize_database(&connection)?;
            app.manage(Tracker {
                database: Mutex::new(connection),
                last_sync: Mutex::new(Instant::now()),
            });

            let tracker_app = app.handle().clone();
            thread::spawn(move || loop {
                thread::sleep(StdDuration::from_secs(15));
                let tracker = tracker_app.state::<Tracker>();
                let _ = collect_activity(&tracker);
            });

            let open_item = MenuItem::with_id(app, "open", "Abrir Workdeck", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Sair completamente", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&open_item, &quit_item])?;
            let mut tray_builder = TrayIconBuilder::with_id("workdeck-tray")
                .tooltip("Workdeck — rastreamento ativo")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show_main_window(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            #[cfg(target_os = "macos")]
            {
                tray_builder = tray_builder.icon_as_template(true);
            }
            tray_builder.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" { return; }
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.set_skip_taskbar(true);
                    let _ = window.hide();
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![sync_activity, add_tracked_app, show_friend_notification, open_friend_chat, check_for_update, install_update])
        .build(tauri::generate_context!())
        .expect("error while building Workdeck")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                show_main_window(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
