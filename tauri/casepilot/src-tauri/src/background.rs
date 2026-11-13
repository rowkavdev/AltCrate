use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Manager,
};

pub fn show(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn setup(app: &tauri::AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(
        app,
        "background-open",
        "Abrir AltCrate",
        true,
        None::<&str>,
    )?;
    let hint = MenuItem::with_id(
        app,
        "background-hint",
        "O trabalho continua com a janela fechada",
        false,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(
        app,
        "background-quit",
        "Sair do AltCrate",
        true,
        None::<&str>,
    )?;
    let menu = Menu::with_items(app, &[&open, &hint, &separator, &quit])?;
    let mut tray = TrayIconBuilder::with_id("casepilot-background")
        .tooltip("AltCrate · Operações em segundo plano")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "background-open" => show(app),
            "background-quit" => super::shutdown(app),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}
