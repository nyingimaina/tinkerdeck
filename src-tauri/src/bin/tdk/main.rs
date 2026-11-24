//! `tdk`: the command line and MCP front end of Tinkerdeck (BRS 7.12).
//! A console program (the window app is a separate GUI exe); it only needs the running engine.

mod cli;
mod client;
mod mcp;
mod register;

use cli::Parsed;

fn main() {
    std::process::exit(real_main());
}

fn real_main() -> i32 {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match cli::parse(&args) {
        Err(e) => {
            eprintln!("{e}");
            2
        }
        Ok(Parsed::Help) => {
            print!("{}", cli::HELP);
            0
        }
        Ok(Parsed::Version) => {
            println!("tdk {}", env!("CARGO_PKG_VERSION"));
            0
        }
        Ok(Parsed::Mcp) => mcp::run_stdio(),
        Ok(Parsed::Llms) => {
            print!("{}", mcp::LLM_GUIDE);
            0
        }
        Ok(Parsed::McpAdmin { action, clients }) => mcp_admin(&action, &clients),
        Ok(Parsed::Ui) => match client::open_ui() {
            Ok(()) => 0,
            Err(e) => {
                eprintln!("error: {e}");
                1
            }
        },
        Ok(Parsed::Doctor) => doctor(),
        Ok(Parsed::Call { method, params, json, view }) => {
            let mut c = match client::Client::connect(method != "quit" && method != "ping") {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("error: {e}");
                    return 1;
                }
            };
            match c.call(&method, params) {
                Ok(v) => {
                    if json {
                        println!("{v}");
                    } else {
                        println!("{}", cli::render(view, &v));
                    }
                    cli::exit_code(view, &v)
                }
                Err(e) => {
                    eprintln!("error: {e}");
                    1
                }
            }
        }
    }
}

fn doctor() -> i32 {
    println!("tdk {}", env!("CARGO_PKG_VERSION"));
    println!("config folder: {}", client::config_dir().display());
    match client::Client::connect(false).and_then(|mut c| c.call("ping", serde_json::json!({}))) {
        Ok(v) => {
            println!("engine: running (version {}, pid {})", v["version"].as_str().unwrap_or("?"), v["pid"]);
            0
        }
        Err(e) => {
            println!("engine: not running ({e})");
            1
        }
    }
}

/// Register (or remove, or list) the MCP server in the LLM clients installed on this PC.
fn mcp_admin(action: &str, wanted: &[String]) -> i32 {
    let exe = match std::env::current_exe() {
        Ok(e) => e.display().to_string(),
        Err(e) => {
            eprintln!("error: {e}");
            return 1;
        }
    };
    if action == "config" {
        println!("{}", register::snippet(&exe));
        return 0;
    }
    let chosen = match register::select(register::clients(), wanted) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("error: {e}");
            return 2;
        }
    };
    if action == "status" {
        for c in register::clients() {
            let state = if !c.present() { "not installed" } else if register::is_registered(&c) { "registered" } else { "installed, not registered" };
            println!("{:<18} {}", c.name, state);
        }
        return 0;
    }
    if chosen.is_empty() {
        println!("No supported LLM client found. Use `tdk mcp config` and paste the snippet into your client's MCP settings.");
        return 0;
    }
    let mut failed = false;
    for c in chosen {
        let r = if action == "uninstall" { register::uninstall_all(&c) } else { register::install_and_migrate(&c, &exe) };
        match r {
            Ok(ch) => println!("{:<18} {}  ({})", c.name, register::describe(ch), c.file.display()),
            Err(e) => {
                failed = true;
                eprintln!("{:<18} FAILED: {e}", c.name);
            }
        }
    }
    if !failed && action == "install" {
        println!("Restart the client to see the tinkerdeck tools.");
    }
    i32::from(failed)
}
