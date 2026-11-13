//! Account requests use the same WebKit session as the visible sign-in window.
//! The site remains responsible for its interactive verification and authentication.
use super::*;

pub async fn identity(window: &WebviewWindow, state: &Engine) -> Result<Value, String> {
    if let Some(user_agent) = state
        .browser_identities
        .lock()
        .unwrap()
        .get(window.label())
        .cloned()
    {
        return Ok(json!({"userAgent":user_agent}));
    }
    // A newly created WKWebView can replace its initial about:blank document
    // before the first script callback arrives. Wait for that local document;
    // this never retries a site request or an authentication submission.
    let value = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match evaluate(window, "navigator.userAgent".into()).await {
                Ok(value) if value.as_str().is_some() => return value,
                _ => tokio::time::sleep(Duration::from_millis(100)).await,
            }
        }
    })
    .await
    .map_err(|_| "Não foi possível identificar o navegador do sistema.")?;
    let user_agent = value
        .as_str()
        .filter(|ua| !ua.is_empty() && ua.len() <= 1024 && !ua.contains(['\r', '\n']))
        .ok_or("Não foi possível identificar o navegador do sistema.")?;
    state
        .browser_identities
        .lock()
        .unwrap()
        .insert(window.label().to_string(), user_agent.to_string());
    Ok(json!({"userAgent":user_agent}))
}

pub fn close_retained(app: &tauri::AppHandle, state: &Engine, partition: &str) {
    if let Some(window) = login_for(app, state, partition) {
        if state
            .retained
            .lock()
            .unwrap()
            .remove(window.label())
            .is_some()
        {
            state.logins.lock().unwrap().remove(window.label());
            let _ = window.close();
        }
    }
}
pub fn trim(app: &tauri::AppHandle, state: &Engine, current: &str) {
    loop {
        let candidate = {
            let retained = state.retained.lock().unwrap();
            if retained.len() <= 6 {
                return;
            }
            let busy = state.browser_requests.lock().unwrap();
            retained
                .iter()
                .filter(|(label, _)| {
                    label.as_str() != current && !busy.values().any(|(active, _)| active == *label)
                })
                .min_by_key(|(_, time)| *time)
                .map(|(label, _)| label.clone())
        };
        let Some(label) = candidate else {
            return;
        };
        state.retained.lock().unwrap().remove(&label);
        state.logins.lock().unwrap().remove(&label);
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.close();
        }
    }
}
pub async fn prepare(
    app: &tauri::AppHandle,
    state: Arc<Engine>,
    mut args: Value,
) -> Result<Value, String> {
    if let Some(window) = login_for(app, &state, text(&args, "partition")?) {
        if let Some(time) = state.retained.lock().unwrap().get_mut(window.label()) {
            *time = state.sequence.fetch_add(1, Ordering::SeqCst);
        }
        return identity(&window, &state).await;
    }
    let id = format!("login-session-{}", uuid::Uuid::new_v4());
    args["id"] = json!(id);
    args["background"] = json!(true);
    args["title"] = json!("AltCrate · sessão da conta");
    create_login(app, state.clone(), &args)?;
    let window = app.get_webview_window(&id).ok_or("Sessão indisponível.")?;
    let (tx, rx) = oneshot::channel();
    state.loads.lock().unwrap().insert(id.clone(), tx);
    if window
        .navigate(game_url("https://case-clicker.com/auth/login")?)
        .is_err()
    {
        state.loads.lock().unwrap().remove(&id);
        let _ = window.close();
        return Err("Não foi possível recuperar a sessão.".into());
    }
    let result = tokio::time::timeout(Duration::from_secs(45), rx).await;
    state.loads.lock().unwrap().remove(&id);
    if !matches!(result, Ok(Ok(Ok(_)))) {
        let _ = window.close();
        return Err("A sessão não terminou de carregar. Entra novamente na conta.".into());
    }
    state
        .retained
        .lock()
        .unwrap()
        .insert(id.clone(), state.sequence.fetch_add(1, Ordering::SeqCst));
    trim(app, &state, &id);
    identity(&window, &state).await
}

pub async fn evaluate(window: &WebviewWindow, script: String) -> Result<Value, String> {
    let (tx, rx) = oneshot::channel();
    let tx = Arc::new(Mutex::new(Some(tx)));
    window
        .eval_with_callback(script, move |value| {
            if let Some(tx) = tx.lock().unwrap().take() {
                let _ = tx.send(serde_json::from_str::<Value>(&value).unwrap_or(Value::Null));
            }
        })
        .map_err(|_| "Não foi possível verificar a janela de login.")?;
    tokio::time::timeout(Duration::from_secs(10), rx)
        .await
        .map_err(|_| "A janela de login não respondeu.")?
        .map_err(|_| "A página de login ainda está a carregar.".into())
}

pub fn cancel(app: &tauri::AppHandle, state: &Engine, transport_id: &str) {
    if let Some((label, nonce)) = state.browser_requests.lock().unwrap().remove(transport_id) {
        if let Some(window) = app.get_webview_window(&label) {
            let _=window.eval(format!("window.__casepilotReads?.[{}]?.controller.abort();delete window.__casepilotReads?.[{}];",json!(nonce),json!(nonce)));
        }
    }
}

pub async fn fetch(
    app: &tauri::AppHandle,
    state: Arc<Engine>,
    args: Value,
) -> Result<Value, String> {
    let partition = text(&args, "partition")?;
    let Some(window) = login_for(app, &state, partition) else {
        return Ok(Value::Null);
    };
    let target = game_url(text(&args, "url")?)?;
    let method = args["method"].as_str().unwrap_or("GET");
    if !["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].contains(&method) {
        return Err("Método de pedido inválido.".into());
    }
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
    let nonce = uuid::Uuid::new_v4().to_string();
    let transport = text(&args, "transportId")?.to_string();
    let request = json!({"url":target,"method":method,"headers":args["headers"],"body":args["body"],"credentials":args["credentials"].as_str().unwrap_or("include")});
    let script = format!(
        r#"(()=>{{
      const key={key},request={request},controller=new AbortController();
      window.__casepilotReads ||= Object.create(null);
      const task={{controller,done:false}};window.__casepilotReads[key]=task;
      (async()=>{{try{{
        const body=request.body==null?undefined:Uint8Array.from(atob(request.body),c=>c.charCodeAt(0));
        const response=await fetch(request.url,{{method:request.method,body,headers:request.headers,credentials:request.credentials,cache:'no-store',redirect:'error',signal:controller.signal}});
        const bytes=new Uint8Array(await response.arrayBuffer());
        if(bytes.length>16*1024*1024)throw Error('Resposta demasiado grande.');
        let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
        task.result={{status:response.status,statusText:response.statusText,headers:Object.fromEntries(response.headers),body:btoa(binary)}};
      }}catch(error){{task.error=error.name==='AbortError'?'Pedido cancelado. Verifica o estado antes de repetir.':'Não foi possível concluir o pedido. Verifica o estado antes de repetir.';}}finally{{task.done=true;}}}})();return true;
    }})()"#,
        key = json!(nonce),
        request = request
    );
    state.browser_requests.lock().unwrap().insert(
        transport.clone(),
        (window.label().to_string(), nonce.clone()),
    );
    let outcome:Result<Value,String>=async{
        evaluate(&window,script).await?;
        for _ in 0..300{
            if !state.browser_requests.lock().unwrap().contains_key(&transport){return Err("Pedido cancelado. Verifica o estado antes de repetir.".into());}
            let value=evaluate(&window,format!("(()=>{{const task=window.__casepilotReads?.[{}];return task?.done?{{done:true,result:task.result,error:task.error}}:{{done:false}};}})()",json!(nonce))).await?;
            if value["done"]==true{
                if let Some(error)=value["error"].as_str(){return Err(error.to_string());}
                return Ok(value["result"].clone());
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        Err("A validação do login excedeu o tempo disponível.".into())
    }.await;
    cancel(app, &state, &transport);
    outcome
}
