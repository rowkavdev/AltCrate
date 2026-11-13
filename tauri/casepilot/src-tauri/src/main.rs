#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod acceptance;
mod background;
mod native_login;
mod sidecar_protocol;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tokio::{
    io::{AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{oneshot, Mutex as AsyncMutex},
};

type Reply = oneshot::Sender<Result<Value, String>>;
#[derive(Default)]
struct Startup {
    error: Mutex<Option<String>>,
}
struct Engine {
    input: AsyncMutex<ChildStdin>,
    child: AsyncMutex<Child>,
    pending: Mutex<HashMap<String, Reply>>,
    channels: Mutex<HashSet<String>>,
    ready: AtomicBool,
    failed: Mutex<Option<String>>,
    closing: AtomicBool,
    restart: AtomicBool,
    sequence: AtomicU64,
    logins: Mutex<HashMap<String, String>>,
    loads: Mutex<HashMap<String, Reply>>,
    browser_requests: Mutex<HashMap<String, (String, String)>>,
    retained: Mutex<HashMap<String, u64>>,
    #[cfg(target_os = "linux")]
    data_directory: PathBuf,
    browser_identities: Mutex<HashMap<String, String>>,
}
impl Engine {
    async fn send(&self, value: Value) -> Result<(), String> {
        let mut bytes = serde_json::to_vec(&value).map_err(|_| "Pedido inválido.")?;
        bytes.push(b'\n');
        self.input
            .lock()
            .await
            .write_all(&bytes)
            .await
            .map_err(|_| "O serviço de operações terminou.".into())
    }
    async fn call(&self, channel: String, args: Vec<Value>) -> Result<Value, String> {
        for _ in 0..300 {
            if self.ready.load(Ordering::SeqCst) {
                break;
            }
            if let Some(error) = self.failed.lock().unwrap().clone() {
                return Err(error);
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        if !self.ready.load(Ordering::SeqCst) {
            return Err("O serviço de operações não iniciou.".into());
        }
        if !self.channels.lock().unwrap().contains(&channel) {
            return Err("Operação desconhecida.".into());
        }
        let id = format!("tauri-{}", self.sequence.fetch_add(1, Ordering::SeqCst));
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id.clone(), tx);
        if let Err(error) = self
            .send(json!({"type":"command","id":id,"channel":channel,"args":args}))
            .await
        {
            self.pending.lock().unwrap().remove(&id);
            return Err(error);
        }
        // Mutation timeouts must remain visible and must never trigger an automatic retry.
        let result = tokio::time::timeout(Duration::from_secs(300), rx).await;
        self.pending.lock().unwrap().remove(&id);
        match result {
            Ok(Ok(value)) => value,
            _ => {
                Err("A resposta não chegou. Verifica o estado antes de repetir a operação.".into())
            }
        }
    }
    fn fail(&self) {
        self.ready.store(false, Ordering::SeqCst);
        let error =
            "O serviço de operações terminou. Reinicia a app para recuperar o estado guardado."
                .to_string();
        *self.failed.lock().unwrap() = Some(error.clone());
        for (_, reply) in self.pending.lock().unwrap().drain() {
            let _ = reply.send(Err(error.clone()));
        }
    }
}
fn local_workspace(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Pedido fora do espaço de trabalho.".into());
    }
    let url = window.url().map_err(|_| "Origem inválida.")?;
    if workspace_url(&url) {
        Ok(())
    } else {
        Err("Origem inválida.".into())
    }
}
fn workspace_url(url: &tauri::Url) -> bool {
    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (url.scheme() == "http"
            && url.host_str() == Some("tauri.localhost")
            && url.port().is_none())
        || (cfg!(debug_assertions) && url.origin().ascii_serialization() == "http://127.0.0.1:1420")
}
fn login_navigation(url: &tauri::Url) -> bool {
    // WKWebView sends child-frame navigations through this callback too.
    // Turnstile must load normally; it never receives workspace permissions.
    matches!(url.as_str(), "about:blank" | "about:srcdoc")
        || game_url(url.as_str()).is_ok()
        || (url.scheme() == "https"
            && url.host_str() == Some("challenges.cloudflare.com")
            && url.port_or_known_default() == Some(443)
            && url.username().is_empty()
            && url.password().is_none())
}
#[tauri::command]
async fn engine_invoke(
    window: WebviewWindow,
    app: tauri::AppHandle,
    channel: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    local_workspace(&window)?;
    let started = std::time::Instant::now();
    let state = loop {
        if let Some(state) = app.try_state::<Arc<Engine>>() {
            break state.inner().clone();
        }
        if let Some(error) = app.state::<Startup>().error.lock().unwrap().clone() {
            return Err(error);
        }
        if started.elapsed() > Duration::from_secs(45) {
            return Err("O arranque aguarda acesso ao Porta-chaves. Autoriza o pedido do AltCrate no macOS e volta a abrir a app.".into());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    };
    state.call(channel, args).await
}
fn game_url(value: &str) -> Result<tauri::Url, String> {
    let url = tauri::Url::parse(value).map_err(|_| "Endereço inválido.")?;
    if url.scheme() != "https"
        || url.host_str() != Some("case-clicker.com")
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("A ligação não pertence ao site do jogo.".into());
    }
    Ok(url)
}
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| "Pedido nativo inválido.".into())
}
fn login_for(app: &tauri::AppHandle, state: &Engine, partition: &str) -> Option<WebviewWindow> {
    let label = state.logins.lock().unwrap().iter().find_map(|(id, p)| {
        if p == partition {
            Some(id.clone())
        } else {
            None
        }
    })?;
    app.get_webview_window(&label)
}
fn apply_cookies(window: &WebviewWindow, values: &Value) -> Result<(), String> {
    let Some(cookies) = values.as_array() else {
        return Ok(());
    };
    for cookie in window
        .cookies_for_url(game_url("https://case-clicker.com/")?)
        .map_err(|_| "Não foi possível preparar a sessão.")?
    {
        window
            .delete_cookie(cookie)
            .map_err(|_| "Não foi possível atualizar a sessão.")?;
    }
    for value in cookies {
        let name = text(value, "name")?;
        let cookie_value = text(value, "value")?;
        let domain = value["domain"].as_str().unwrap_or("case-clicker.com");
        if !["case-clicker.com", ".case-clicker.com"].contains(&domain) {
            continue;
        }
        let mut cookie =
            tauri::webview::Cookie::build((name.to_string(), cookie_value.to_string()))
                .domain(domain.to_string())
                .path(value["path"].as_str().unwrap_or("/").to_string())
                .secure(value["secure"].as_bool().unwrap_or(true))
                .http_only(value["httpOnly"].as_bool().unwrap_or(false));
        if let Some(expiry) = value["expirationDate"].as_i64() {
            let expiry = time::OffsetDateTime::from_unix_timestamp(expiry)
                .map_err(|_| "Prazo de sessão inválido.")?;
            if expiry <= time::OffsetDateTime::now_utc() {
                continue;
            }
            cookie = cookie.expires(expiry);
        }
        window
            .set_cookie(cookie.build())
            .map_err(|_| "Não foi possível preparar a sessão de login.")?;
    }
    Ok(())
}
fn create_login(app: &tauri::AppHandle, state: Arc<Engine>, args: &Value) -> Result<(), String> {
    let id = text(&args, "id")?.to_string();
    let partition = text(&args, "partition")?.to_string();
    if !id.starts_with("login-") || id.len() > 80 || partition.len() > 200 {
        return Err("Sessão de login inválida.".into());
    }
    let background = args["background"].as_bool().unwrap_or(false);
    let mut builder=WebviewWindowBuilder::new(app,&id,WebviewUrl::External("about:blank".parse().unwrap()))
                .title(args["title"].as_str().unwrap_or("Entrar"))
                .visible(!background).focused(!background)
                .inner_size(args["width"].as_f64().unwrap_or(1050.0),args["height"].as_f64().unwrap_or(800.0))
                .on_navigation(login_navigation)
                .on_new_window(|_,_|tauri::webview::NewWindowResponse::Deny)
                .on_page_load({let state=state.clone();let id=id.clone();move|window,payload|{
                    if matches!(payload.event(),tauri::webview::PageLoadEvent::Finished){
                        if game_url(payload.url().as_str()).is_ok(){if let Some(reply)=state.loads.lock().unwrap().remove(&id){let _=reply.send(Ok(json!(true)));}}
                        let message=json!({"type":"native-event","id":id,"event":"did-finish-load","url":window.url().ok().map(|u|u.to_string())});
                        let state=state.clone();tauri::async_runtime::spawn(async move{let _=state.send(message).await;});
                    }
                }});
    let store = uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_URL, partition.as_bytes());
    #[cfg(target_os = "macos")]
    {
        builder = builder.data_store_identifier(*store.as_bytes());
    }
    #[cfg(target_os = "linux")]
    {
        builder = builder.data_directory(state.data_directory.join("webkit").join(store.to_string()));
    }
    // Use WebKit's real identity. A fixed Safari version does not describe
    // the embedded browser and becomes stale when the system WebKit changes.
    if let Some(proxy) = args["proxy"].as_str() {
        let url = tauri::Url::parse(proxy).map_err(|_| "Proxy inválido.")?;
        if !["http", "socks5"].contains(&url.scheme())
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("Proxy inválido.".into());
        }
        builder = builder.proxy_url(url);
    }
    let window = builder
        .build()
        .map_err(|_| "Não foi possível abrir o login.")?;
    state.logins.lock().unwrap().insert(id.clone(), partition);
    if window
        .cookies_for_url(game_url("https://case-clicker.com/")?)
        .map_err(|_| "Sessão indisponível.")?
        .is_empty()
    {
        apply_cookies(&window, &args["cookies"])?;
    }
    window.on_window_event({
        let state = state.clone();
        let id = id.clone();
        move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                state.logins.lock().unwrap().remove(&id);
                state.retained.lock().unwrap().remove(&id);
                state.browser_identities.lock().unwrap().remove(&id);
                if let Some(reply) = state.loads.lock().unwrap().remove(&id) {
                    let _ = reply.send(Err("A janela de login foi fechada.".into()));
                }
                let message = json!({"type":"native-event","id":id,"event":"closed"});
                let state = state.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = state.send(message).await;
                });
            }
        }
    });
    Ok(())
}
async fn native(
    app: tauri::AppHandle,
    state: Arc<Engine>,
    method: &str,
    args: Value,
) -> Result<Value, String> {
    match method {
        "dialog.open" | "dialog.save" => {
            let options = args.get("options").cloned().unwrap_or(json!({}));
            let mut builder = app.dialog().file();
            if let Some(title) = options["title"].as_str() {
                builder = builder.set_title(title);
            }
            if let Some(path) = options["defaultPath"].as_str() {
                builder = builder.set_file_name(path);
            }
            if let Some(filters) = options["filters"].as_array() {
                for filter in filters {
                    if let (Some(name), Some(extensions)) =
                        (filter["name"].as_str(), filter["extensions"].as_array())
                    {
                        let extensions: Vec<&str> =
                            extensions.iter().filter_map(Value::as_str).collect();
                        builder = builder.add_filter(name, &extensions);
                    }
                }
            }
            let open = method == "dialog.open";
            let selected = tauri::async_runtime::spawn_blocking(move || {
                if open {
                    builder.blocking_pick_file()
                } else {
                    builder.blocking_save_file()
                }
            })
            .await
            .map_err(|_| "Não foi possível abrir o seletor.")?;
            let path = selected
                .and_then(|p| p.into_path().ok())
                .map(|p| p.to_string_lossy().into_owned());
            Ok(if open {
                json!({"canceled":path.is_none(),"filePaths":path.into_iter().collect::<Vec<_>>()})
            } else {
                json!({"canceled":path.is_none(),"filePath":path})
            })
        }
        "desktop.open" => {
            let url = game_url(text(&args, "url")?)?;
            #[cfg(target_os = "macos")]
            let opener = "/usr/bin/open";
            #[cfg(target_os = "linux")]
            let opener = "/usr/bin/xdg-open";
            let status = Command::new(opener)
                .arg(url.as_str())
                .status()
                .await
                .map_err(|_| "Não foi possível abrir a ligação.")?;
            Ok(json!(status.success()))
        }
        "login.create" => {
            let partition = text(&args, "partition")?.to_string();
            let origin = game_url("https://case-clicker.com/")?;
            let retained_cookies = login_for(&app, &state, &partition)
                .filter(|window| state.retained.lock().unwrap().contains_key(window.label()))
                .map(|window| window.cookies_for_url(origin))
                .transpose()
                .map_err(|_| "Não foi possível preservar a sessão de login.")?;
            native_login::close_retained(&app, &state, &partition);
            create_login(&app, state.clone(), &args)?;
            if let Some(cookies) = retained_cookies {
                let window = app.get_webview_window(text(&args, "id")?).ok_or("Sessão indisponível.")?;
                for cookie in cookies {
                    if window.set_cookie(cookie).is_err() {
                        let _ = window.close();
                        return Err("Não foi possível restaurar a sessão de login.".into());
                    }
                }
            }
            Ok(Value::Null)
        }
        "session.prepare" => native_login::prepare(&app, state, args).await,
        "session.invalidate" => {
            native_login::close_retained(&app, &state, text(&args, "partition")?);
            Ok(Value::Null)
        }
        "login.retain" => {
            let id = text(&args, "id")?;
            let window = app
                .get_webview_window(id)
                .ok_or("A janela de login foi fechada.")?;
            window
                .hide()
                .map_err(|_| "Não foi possível guardar a sessão.")?;
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.set_focus();
            }
            state.retained.lock().unwrap().insert(
                id.to_string(),
                state.sequence.fetch_add(1, Ordering::SeqCst),
            );
            native_login::trim(&app, &state, id);
            Ok(Value::Null)
        }
        "login.cookies" => {
            let partition = text(&args, "partition")?;
            if let Some(window) = login_for(&app, &state, partition) {
                let cookies = window
                    .cookies_for_url(game_url("https://case-clicker.com/")?)
                    .map_err(|_| "Não foi possível ler a sessão de login.")?;
                Ok(Value::Array(cookies.into_iter().map(|c|json!({"name":c.name(),"value":c.value(),"domain":c.domain().unwrap_or("case-clicker.com"),"path":c.path().unwrap_or("/"),"secure":c.secure().unwrap_or(true),"httpOnly":c.http_only().unwrap_or(false),"expirationDate":c.expires_datetime().map(|t|t.unix_timestamp())})).collect()))
            } else {
                Ok(Value::Null)
            }
        }
        "login.setCookies" => {
            if let Some(window) = login_for(&app, &state, text(&args, "partition")?) {
                apply_cookies(&window, &args["cookies"])?;
            }
            Ok(Value::Null)
        }
        "login.clear" => {
            if let Some(window) = login_for(&app, &state, text(&args, "partition")?) {
                window
                    .clear_all_browsing_data()
                    .map_err(|_| "Não foi possível limpar a sessão.")?;
            }
            Ok(Value::Null)
        }
        "login.fetch" => native_login::fetch(&app, state, args).await,
        "login.load" => {
            let id = text(&args, "id")?.to_string();
            let window = app
                .get_webview_window(&id)
                .ok_or("A janela de login foi fechada.")?;
            let url = game_url(text(&args, "url")?)?;
            let (tx, rx) = oneshot::channel();
            state.loads.lock().unwrap().insert(id.clone(), tx);
            if window.navigate(url).is_err() {
                state.loads.lock().unwrap().remove(&id);
                return Err("Não foi possível abrir o site.".into());
            }
            let value = tokio::time::timeout(Duration::from_secs(45), rx).await;
            state.loads.lock().unwrap().remove(&id);
            match value {
                Ok(Ok(result)) => {
                    result?;
                    native_login::identity(&window, &state).await
                }
                _ => Err("A página de login não terminou de carregar. Tenta novamente.".into()),
            }
        }
        "login.close" => {
            if let Some(window) = app.get_webview_window(text(&args, "id")?) {
                window
                    .close()
                    .map_err(|_| "Não foi possível fechar o login.")?;
            }
            Ok(Value::Null)
        }
        "login.script" => {
            let window = app
                .get_webview_window(text(&args, "id")?)
                .ok_or("A janela de login foi fechada.")?;
            if game_url(
                window
                    .url()
                    .map_err(|_| "O login ainda está a carregar.")?
                    .as_str(),
            )
            .is_err()
            {
                return Ok(Value::Null);
            }
            match native_login::evaluate(&window, text(&args, "script")?.to_string()).await {
                Ok(value) => Ok(value),
                Err(_) if app.get_webview_window(text(&args, "id")?).is_some() => Ok(Value::Null),
                Err(error) => Err(error),
            }
        }
        _ => Err("Integração nativa desconhecida.".into()),
    }
}
fn vault_key(fixture: bool) -> Result<String, Box<dyn std::error::Error>> {
    let generate = || {
        STANDARD.encode(
            [
                uuid::Uuid::new_v4().as_bytes().as_slice(),
                uuid::Uuid::new_v4().as_bytes().as_slice(),
            ]
            .concat(),
        )
    };
    if fixture {
        return Ok(generate());
    }
    let entry = keyring::Entry::new("pt.casepilot.desktop", "session-vault")?;
    match entry.get_password() {
        Ok(key) => {
            if STANDARD.decode(&key)?.len() != 32 {
                return Err("Chave local inválida.".into());
            }
            Ok(key)
        }
        Err(keyring::Error::NoEntry) => {
            let key = generate();
            entry.set_password(&key)?;
            Ok(key)
        }
        Err(_) => Err("Não foi possível desbloquear a proteção de sessões do sistema.".into()),
    }
}
fn start_engine(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let fixture = std::env::var("CASEPILOT_FIXTURE").ok().as_deref() == Some("1");
    let data = if fixture {
        std::env::temp_dir().join(format!("casepilot-tauri-fixture-{}", uuid::Uuid::new_v4()))
    } else {
        app.path().app_data_dir()?
    };
    std::fs::create_dir_all(&data)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&data, std::fs::Permissions::from_mode(0o700))?;
    }
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let runtime = if cfg!(debug_assertions) {
        root.join("../../runtime").canonicalize()?
    } else {
        app.path().resource_dir()?.join("runtime")
    };
    let node = if cfg!(debug_assertions) {
        root.join(concat!("binaries/casepilot-node-", env!("TAURI_ENV_TARGET_TRIPLE")))
    } else {
        std::env::current_exe()?
            .parent()
            .unwrap()
            .join("casepilot-node")
    };
    let key = vault_key(fixture)?;
    #[cfg(target_os = "macos")]
    let browser_executable = if fixture {
        None
    } else if cfg!(debug_assertions) {
        Some(root.join("../../../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"))
    } else {
        Some(runtime.join("chromium/Electron.app/Contents/MacOS/Electron"))
    };
    #[cfg(target_os = "linux")]
    let browser_executable: Option<PathBuf> = None;
    let mut command = Command::new(node);
    command
        .arg(runtime.join("engine/desktop-worker.cjs"))
        .current_dir(&runtime)
        .env_remove("NODE_OPTIONS")
        .env_remove("ELECTRON_RUN_AS_NODE")
        .env_remove("VITE_DEV_SERVER_URL")
        .env_remove("CASE_CLICKER_TEST_DATA_DIR")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    let mut child = tauri::async_runtime::block_on(async move { command.spawn() })?;
    let input = child.stdin.take().unwrap();
    let output = child.stdout.take().unwrap();
    let state = Arc::new(Engine {
        input: AsyncMutex::new(input),
        child: AsyncMutex::new(child),
        pending: Mutex::new(HashMap::new()),
        channels: Mutex::new(HashSet::new()),
        ready: AtomicBool::new(false),
        failed: Mutex::new(None),
        closing: AtomicBool::new(false),
        restart: AtomicBool::new(false),
        sequence: AtomicU64::new(1),
        logins: Mutex::new(HashMap::new()),
        loads: Mutex::new(HashMap::new()),
        browser_requests: Mutex::new(HashMap::new()),
        retained: Mutex::new(HashMap::new()),
        #[cfg(target_os = "linux")]
        data_directory: data.clone(),
        browser_identities: Mutex::new(HashMap::new()),
    });
    app.manage(state.clone());
    let handle = app.clone();
    let reader_state = state.clone();
    tauri::async_runtime::spawn(async move {
        let mut reader = BufReader::new(output);
        let mut frame = Vec::new();
        while let Ok(true) = sidecar_protocol::read_frame(
            &mut reader,
            &mut frame,
            sidecar_protocol::MAX_FRAME_BYTES,
        ).await {
            let Ok(message) = serde_json::from_slice::<Value>(&frame) else {
                continue;
            };
            match message["type"].as_str().unwrap_or("") {
                "ready" => {
                    *reader_state.channels.lock().unwrap() = message["channels"]
                        .as_array()
                        .unwrap_or(&vec![])
                        .iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect();
                    reader_state.ready.store(true, Ordering::SeqCst);
                }
                "result" => {
                    if let Some(id) = message["id"].as_str() {
                        let reply = reader_state.pending.lock().unwrap().remove(id);
                        if let Some(reply) = reply {
                            let result = if let Some(error) = message["error"].as_str() {
                                Err(error.to_string())
                            } else {
                                Ok(message["result"].clone())
                            };
                            let _ = reply.send(result);
                        }
                    }
                }
                "event" => {
                    let _ = handle.emit_to("main", "casepilot:event", &message["payload"]);
                }
                "native-cancel" => {
                    if let Some(id) = message["id"].as_str() {
                        native_login::cancel(&handle, &reader_state, id);
                    }
                }
                "native-request" => {
                    let app = handle.clone();
                    let state = reader_state.clone();
                    tauri::async_runtime::spawn(async move {
                        let result = native(
                            app,
                            state.clone(),
                            message["method"].as_str().unwrap_or(""),
                            {
                                let mut args = message["args"].clone();
                                args["transportId"] = message["id"].clone();
                                args
                            },
                        )
                        .await;
                        let reply = match result {
                            Ok(value) => {
                                json!({"type":"native-result","id":message["id"],"result":value})
                            }
                            Err(error) => {
                                json!({"type":"native-result","id":message["id"],"error":error})
                            }
                        };
                        let _ = state.send(reply).await;
                    });
                }
                "focus" => {
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                }
                "relaunch" => {
                    reader_state.restart.store(true, Ordering::SeqCst);
                }
                "closed" => {
                    if reader_state.restart.load(Ordering::SeqCst) {
                        handle.restart();
                    } else {
                        handle.exit(0);
                    }
                    return;
                }
                "fatal" => {
                    reader_state.fail();
                    let _=handle.emit_to("main","casepilot:event",json!({"type":"notice","message":"Não foi possível iniciar o serviço de operações. Reinicia a app."}));
                }
                _ => {}
            }
        }
        reader_state.fail();
        let _ = reader_state.child.lock().await.kill().await;
        let _=handle.emit_to("main","casepilot:event",json!({"type":"notice","message":"O serviço de operações terminou. Reinicia a app para recuperar o estado guardado."}));
    });
    tauri::async_runtime::spawn(async move {
        let _=state.send(json!({"type":"initialize","configuration":{"dataDirectory":data,"appDataDirectory":data.parent(),"vaultKey":key,"browserExecutable":browser_executable}})).await;
    });
    Ok(())
}
fn shutdown(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<Arc<Engine>>() {
        if state.closing.swap(true, Ordering::SeqCst) {
            return;
        }
        let state = state.inner().clone();
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = state.send(json!({"type":"shutdown"})).await;
            tokio::time::sleep(Duration::from_secs(8)).await;
            let _ = state.child.lock().await.kill().await;
            app.exit(0);
        });
    } else {
        app.exit(0);
    }
}
fn main() {
    let fixture = std::env::var("CASEPILOT_FIXTURE").ok().as_deref() == Some("1");
    let mut context = tauri::generate_context!();
    if fixture {
        for window in &mut context.config_mut().app.windows {
            #[cfg(target_os = "macos")]
            {
                window.data_store_identifier = Some(*uuid::Uuid::new_v4().as_bytes());
            }
            #[cfg(target_os = "linux")]
            {
                window.data_directory = Some(PathBuf::from(format!("fixture-{}", uuid::Uuid::new_v4())));
            }
        }
    }
    let builder = tauri::Builder::default().manage(Startup::default());
    let builder = if fixture {
        builder
    } else {
        builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
            background::show(app);
        }))
    };
    builder
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![engine_invoke])
        .setup(move |app| {
            if !fixture {
                background::setup(app.handle())?;
            }
            let app = app.handle().clone();
            // Credential-store authorization runs off the desktop event loop.
            std::thread::spawn(move || match start_engine(&app) {
                Ok(()) => acceptance::start(&app),
                Err(error) => {
                    *app.state::<Startup>().error.lock().unwrap() = Some(error.to_string());
                    let _ = app.emit_to(
                        "main",
                        "casepilot:event",
                        json!({"type":"notice","message":error.to_string()}),
                    );
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(context)
        .expect("Não foi possível iniciar o AltCrate.")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = &event {
                background::show(app);
            }
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                    shutdown(app);
                }
            }
        });
}

#[cfg(test)]
mod origin_tests {
    use super::*;
    #[test]
    fn login_allows_site_verification_and_rejects_unrelated_origins() {
        for url in [
            "https://case-clicker.com/auth/login",
            "https://challenges.cloudflare.com/turnstile/v0/abc",
            "about:blank",
            "about:srcdoc",
        ] {
            assert!(login_navigation(&url.parse().unwrap()), "{url}");
        }
        for url in [
            "https://evil.example/",
            "http://challenges.cloudflare.com/",
            "https://challenges.cloudflare.com.evil.example/",
            "https://user:pass@challenges.cloudflare.com/",
            "https://challenges.cloudflare.com:444/",
            "file:///tmp/page.html",
        ] {
            assert!(!login_navigation(&url.parse().unwrap()), "{url}");
        }
    }
    #[test]
    fn workspace_accepts_only_its_local_origin() {
        assert!(workspace_url(&"tauri://localhost/".parse().unwrap()));
        assert!(workspace_url(&"http://tauri.localhost/".parse().unwrap()));
        for url in [
            "tauri://evil.example/",
            "https://tauri.localhost/",
            "https://case-clicker.com/",
            "http://tauri.localhost:8080/",
            "http://127.0.0.1:1420.evil.example/",
        ] {
            if let Ok(url) = url.parse() {
                assert!(!workspace_url(&url));
            }
        }
    }
}
