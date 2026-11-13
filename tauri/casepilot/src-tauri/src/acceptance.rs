use super::*;

pub fn uses_upgrade_profile() -> bool {
    cfg!(target_os = "linux")
        && std::env::var("CASEPILOT_VERIFY_LINUX_UPGRADE").as_deref() == Ok("1")
        && std::env::var_os("XDG_DATA_HOME").is_some_and(|path| PathBuf::from(path).is_absolute())
}

async fn evaluate(window: &WebviewWindow, script: String) -> Result<Value, String> {
    let (tx, rx) = oneshot::channel();
    let tx = Arc::new(Mutex::new(Some(tx)));
    window
        .eval_with_callback(script, move |result| {
            if let Some(tx) = tx.lock().unwrap().take() {
                let _ = tx.send(serde_json::from_str::<Value>(&result).unwrap_or(Value::Null));
            }
        })
        .map_err(|e| e.to_string())?;
    tokio::time::timeout(Duration::from_secs(10), rx)
        .await
        .map_err(|_| "Native WebView did not answer")?
        .map_err(|_| "Native callback was dropped".into())
}
#[cfg(target_os = "macos")]
fn window_id(window: &WebviewWindow) -> Option<isize> {
    use std::ffi::{c_char, c_void};
    #[link(name = "objc")]
    extern "C" {
        fn sel_registerName(name: *const c_char) -> *mut c_void;
        fn objc_msgSend();
    }
    let pointer = window.ns_window().ok()?;
    unsafe {
        let send: extern "C" fn(*mut c_void, *mut c_void) -> isize =
            std::mem::transmute(objc_msgSend as *const ());
        Some(send(pointer, sel_registerName(c"windowNumber".as_ptr())))
    }
}
pub fn start(app: &tauri::AppHandle) {
    if std::env::var("CASEPILOT_FIXTURE").ok().as_deref() != Some("1") {
        return;
    }
    let Ok(destination) = std::env::var("CASEPILOT_VERIFY_UI") else {
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<Arc<Engine>>().inner().clone();
        let destination = PathBuf::from(destination);
        let _ = std::fs::create_dir_all(&destination);
        let upgrade = uses_upgrade_profile();
        let fixture = if upgrade { "isolated Linux upgrade profile" } else { "temporary empty account store" };
        let mut report = json!({"runtime":"Tauri + native WebKit + bundled Node","fixture":fixture,"liveGameRequests":0,"pages":[],"errors":[],"nativeScreenshots":[]});
        let result:Result<(),String>=async{
            let accounts=state.call("accounts:list".into(),vec![]).await?;
            if accounts!=json!([]){return Err("Fixture store was not empty".into());}
            if upgrade {
                let saved = state.call("preferences:read".into(), vec![]).await?;
                if saved != json!({"enableSiteOpening":true}) {
                    return Err("AltCrate did not load the preferences saved by CasePilot".into());
                }
                report["linuxUpgradeDataRetained"] = json!(true);
            } else {
                state.call("preferences:update".into(),vec![json!({"enableSiteOpening":true})]).await?;
            }
            let window=app.get_webview_window("main").ok_or("Missing main window")?;
            window.set_title("AltCrate · Isolated verification").map_err(|e|e.to_string())?;
            let _=window.set_focus();
            // A cold WKWebView may load the renderer after the engine is already ready.
            // Wait for the bridge itself; a fixed delay can miss the only invocation.
            tokio::time::timeout(Duration::from_secs(15),async {
                loop {
                    // WKWebView may discard a callback while the first document is being replaced.
                    if matches!(evaluate(&window,"typeof window.caseClicker?.listAccounts === 'function'".into()).await,Ok(value) if value==json!(true)){return Ok::<_,String>(());}
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            }).await.map_err(|_|"The renderer bridge did not initialize".to_string())??;
            if evaluate(&window,"document.documentElement.lang".into()).await?!=json!("en-GB"){
                return Err("The desktop workspace did not start in English".into());
            }
            let invalid_command=state.call("fixture:unsupported-command".into(),vec![]).await;
            if invalid_command!=Err("Unknown operation.".into()){
                return Err(format!("The desktop engine did not report an English error: {invalid_command:?}"));
            }
            report["englishWorkspace"]=json!(true);
            evaluate(&window,"window.__casepilotBridgeResult=null;Promise.resolve().then(()=>window.caseClicker.listAccounts()).then(value=>window.__casepilotBridgeResult=value).catch(error=>window.__casepilotBridgeResult=String(error));true".into()).await?;
            let bridge_result=tokio::time::timeout(Duration::from_secs(10),async {
                loop {
                    let value=evaluate(&window,"window.__casepilotBridgeResult".into()).await?;
                    if !value.is_null(){return Ok::<_,String>(value);}
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            }).await.map_err(|_|"The renderer account read timed out".to_string())??;
            if bridge_result!=json!([]){return Err(format!("The renderer could not read the native engine: {bridge_result}"));}
            // Enable optional navigation through the same control the user uses.
            evaluate(&window,"document.querySelector('.sidebar a[href=\"#settings\"]')?.click();true".into()).await?;
            tokio::time::sleep(Duration::from_millis(500)).await;
            evaluate(&window,"(()=>{const input=document.querySelector('.optional-feature-choice input');if(input&&!input.checked&&!input.disabled)input.click();return !!input;})()".into()).await?;
            tokio::time::sleep(Duration::from_millis(500)).await;
            let pages=[("overview","Overview"),("accounts","Accounts"),("automation","Automation"),("opening","Open cases"),("converter","Token converter"),("inventory","Inventory"),("games","Games"),("rewards","Rewards"),("skills","Skill maps"),("autoopen","Opening preferences"),("diagnostics","Diagnostics"),("settings","Settings"),("activity","Activity")];
            for (index,(page,heading)) in pages.iter().enumerate(){
                evaluate(&window,format!("document.querySelector('.sidebar a[href=\"#{page}\"]')?.click();true")).await?;
                tokio::time::sleep(Duration::from_millis(350)).await;
                let mut snapshot=evaluate(&window,"({page:location.hash,heading:document.querySelector('h1')?.textContent,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,active:document.querySelector('.sidebar a.active')?.getAttribute('href'),groups:[...document.querySelectorAll('.nav-label')].map(node=>node.textContent),errors:[...document.querySelectorAll('.inline-error')].map(node=>node.textContent)})".into()).await?;
                for _ in 0..20{
                    if snapshot["active"]==json!(format!("#{page}")) && snapshot["heading"]==json!(heading){break;}
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    snapshot=evaluate(&window,"({page:location.hash,heading:document.querySelector('h1')?.textContent,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,active:document.querySelector('.sidebar a.active')?.getAttribute('href'),groups:[...document.querySelectorAll('.nav-label')].map(node=>node.textContent),errors:[...document.querySelectorAll('.inline-error')].map(node=>node.textContent)})".into()).await?;
                }
                if snapshot["heading"]!=json!(heading){return Err(format!("Expected English heading {heading} on {page}: {snapshot}"));}
                if snapshot["active"]!=json!(format!("#{page}")){return Err(format!("Navigation mismatch on {page}: {snapshot}"));}
                if snapshot["scrollWidth"].as_f64().unwrap_or(0.0)>snapshot["width"].as_f64().unwrap_or(0.0)+1.0{return Err(format!("Horizontal overflow on {page}"));}
                report["pages"].as_array_mut().unwrap().push(snapshot);
                #[cfg(target_os="macos")]
                if let Some(id)=window_id(&window){
                    let output=destination.join(format!("{index:02}-{page}.png"));
                    if let Ok(status)=Command::new("/usr/sbin/screencapture").arg("-x").arg("-o").arg("-l").arg(id.to_string()).arg(&output).status().await{if status.success(){report["nativeScreenshots"].as_array_mut().unwrap().push(json!(output));}}
                }
            }
            if std::env::var("CASEPILOT_VERIFY_BACKGROUND").ok().as_deref()==Some("1") {
                // Renderer-owned refresh queues must keep making progress without a visible window.
                evaluate(&window,"window.__casepilotBackgroundTicks=0;window.__casepilotBackgroundTimer=setInterval(()=>window.__casepilotBackgroundTicks++,200);true".into()).await?;
                window.minimize().map_err(|e|e.to_string())?;
                tokio::time::sleep(Duration::from_secs(2)).await;
                let minimized_ticks=evaluate(&window,"window.__casepilotBackgroundTicks".into()).await?;
                report["minimizedTimerTicks"]=minimized_ticks.clone();
                if minimized_ticks.as_u64().unwrap_or(0)==0{return Err("Renderer work stopped while minimized".into());}
                window.hide().map_err(|e|e.to_string())?;
                let before=evaluate(&window,"window.__casepilotBackgroundTicks".into()).await?.as_u64().unwrap_or(0);
                tokio::time::sleep(Duration::from_secs(2)).await;
                let after=evaluate(&window,"window.__casepilotBackgroundTicks".into()).await?.as_u64().unwrap_or(0);
                evaluate(&window,"clearInterval(window.__casepilotBackgroundTimer);true".into()).await?;
                report["hiddenTimerTicks"]=json!(after.saturating_sub(before));
                if after.saturating_sub(before)==0{return Err("Renderer work stopped while hidden".into());}
                if state.call("accounts:list".into(),vec![]).await?!=json!([]){return Err("Background engine read failed".into());}
                if std::env::var("CASEPILOT_VERIFY_LONG_BACKGROUND").ok().as_deref()==Some("1") {
                    // Complete a renderer -> engine round-trip after the default five-minute suspension threshold.
                    // Poll only the engine; evaluating JavaScript during the wait would wake the web view.
                    evaluate(&window,"clearInterval(window.__casepilotBackgroundTimer);setTimeout(()=>window.caseClicker.updateAppPreferences({enableSiteOpening:false}),310000);true".into()).await?;
                    tokio::time::sleep(Duration::from_secs(312)).await;
                    let saved=state.call("preferences:read".into(),vec![]).await?;
                    if saved["enableSiteOpening"]!=json!(false){return Err("Hidden renderer did not complete work after five minutes".into());}
                    report["hiddenCompletionAfterSeconds"]=json!(310);
                }
                window.show().map_err(|e|e.to_string())?;
                window.unminimize().map_err(|e|e.to_string())?;
            }
            let marker=uuid::Uuid::new_v4().to_string();
            let partition_a=format!("fixture-login-a-{marker}");let partition_b=format!("fixture-login-b-{marker}");
            for (id,partition,cookies) in [("login-accept-a",&partition_a,json!([{"name":"casepilot_fixture","value":"isolated","domain":"case-clicker.com","path":"/","secure":true,"httpOnly":true}])),("login-accept-b",&partition_b,json!([]))]{
                native(app.clone(),state.clone(),"login.create",json!({"id":id,"partition":partition,"title":"AltCrate · Local session verification","width":500,"height":350,"cookies":cookies,"userAgent":"AltCrate-fixture-must-not-be-used"})).await?;
                let login=app.get_webview_window(id).ok_or("Missing login identity window")?;
                login.navigate("about:blank".parse().unwrap()).map_err(|e|e.to_string())?;
                let identity=native_login::identity(&login,&state).await?;
                let actual=evaluate(&login,"navigator.userAgent".into()).await?;
                if identity["userAgent"]!=actual || !actual.as_str().unwrap_or("").contains("AppleWebKit") || actual==json!("AltCrate-fixture-must-not-be-used"){return Err("The login browser is not using its native identity".into());}
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
            let cookies_a=native(app.clone(),state.clone(),"login.cookies",json!({"partition":partition_a})).await?;
            let cookies_b=native(app.clone(),state.clone(),"login.cookies",json!({"partition":partition_b})).await?;
            if !cookies_a.as_array().unwrap().iter().any(|c|c["name"]=="casepilot_fixture") || cookies_b.as_array().unwrap().iter().any(|c|c["name"]=="casepilot_fixture"){return Err("Native login cookies are not isolated".into());}
            let login=app.get_webview_window("login-accept-a").ok_or("Missing login window")?;
            if local_workspace(&login).is_ok(){return Err("Login window could access workspace commands".into());}
            native(app.clone(),state.clone(),"login.retain",json!({"id":"login-accept-a"})).await?;
            if login.is_visible().map_err(|e|e.to_string())?{return Err("Retained session did not leave the visible workspace".into());}
            if !state.retained.lock().unwrap().contains_key("login-accept-a"){return Err("Authenticated browser session was discarded".into());}
            let retained=native(app.clone(),state.clone(),"login.cookies",json!({"partition":partition_a})).await?;
            if !retained.as_array().unwrap().iter().any(|c|c["name"]=="casepilot_fixture"){return Err("Retained browser lost its session".into());}
            report["nativeSessionRetained"]=json!(true);
            native(app.clone(),state.clone(),"login.create",json!({"id":"login-accept-reopened","partition":partition_a,"title":"AltCrate · Reopened session","width":500,"height":350,"cookies":[]})).await?;
            let reopened=native(app.clone(),state.clone(),"login.cookies",json!({"partition":partition_a})).await?;
            if !reopened.as_array().unwrap().iter().any(|c|c["name"]=="casepilot_fixture"){return Err("Reopening the login erased existing native cookies".into());}
            report["nativeBrowserIdentity"]=json!(true);report["nativeCookiesPreservedOnReopen"]=json!(true);
            if evaluate(&window,"1+1".into()).await?!=json!(2){return Err("Native WebView script callback failed".into());}
            for (id,partition) in [("login-accept-reopened",partition_a),("login-accept-b",partition_b)]{
                native(app.clone(),state.clone(),"login.clear",json!({"partition":partition})).await?;
                native(app.clone(),state.clone(),"login.close",json!({"id":id})).await?;
            }
            report["nativeLoginIsolation"]=json!(true);report["loginIpcDenied"]=json!(true);report["nativeScriptCallback"]=json!(true);
            if std::env::var("CASEPILOT_VERIFY_BACKGROUND").ok().as_deref()==Some("1") {
                window.close().map_err(|e|e.to_string())?;
                tokio::time::sleep(Duration::from_millis(300)).await;
                if window.is_visible().map_err(|e|e.to_string())? || state.closing.load(Ordering::SeqCst){return Err("Closing the main window shut down background work".into());}
                if state.call("accounts:list".into(),vec![]).await?!=json!([]){return Err("The engine stopped after closing the window".into());}
                window.show().map_err(|e|e.to_string())?;
                window.unminimize().map_err(|e|e.to_string())?;
                report["closeKeepsEngineAlive"]=json!(true);
                evaluate(&window,"window.__casepilotReopened=null;window.caseClicker.listAccounts().then(value=>window.__casepilotReopened=value).catch(error=>window.__casepilotReopened=String(error));true".into()).await?;
                let reopened=tokio::time::timeout(Duration::from_secs(10),async {
                    loop {
                        let value=evaluate(&window,"window.__casepilotReopened".into()).await?;
                        if !value.is_null(){return Ok::<_,String>(value);}
                        tokio::time::sleep(Duration::from_millis(100)).await;
                    }
                }).await.map_err(|_|"Reopened renderer read timed out".to_string())??;
                if reopened!=json!([]){return Err("Reopened renderer could not read the engine".into());}
                report["reopenReadsSavedState"]=json!(true);
            }
            evaluate(&window,"location.hash='#overview';true".into()).await?;
            Ok(())
        }.await;
        if let Err(error) = result {
            report["errors"].as_array_mut().unwrap().push(json!(error));
        }
        report["passed"] = json!(report["errors"].as_array().unwrap().is_empty());
        let temporary = destination.join("native-report.tmp");
        if std::fs::write(&temporary, serde_json::to_vec_pretty(&report).unwrap()).is_ok() {
            let _ = std::fs::rename(temporary, destination.join("native-report.json"));
        }
        if std::env::var("CASEPILOT_VERIFY_EXIT").ok().as_deref() == Some("1") {
            shutdown(&app);
        }
    });
}
