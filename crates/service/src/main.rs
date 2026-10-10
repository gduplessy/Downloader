#![cfg_attr(windows, windows_subsystem = "windows")]
fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = if args.first().map(String::as_str) == Some("daemon") {
        downloader_service::serve()
    } else {
        downloader_service::native(&args)
    };
    if let Err(e) = result {
        eprintln!("Downloader service: {e}");
        std::process::exit(1);
    }
}
