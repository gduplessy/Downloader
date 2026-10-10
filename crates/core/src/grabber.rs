use crate::{model::*, security, transfer, Engine};
use anyhow::{Context, Result};
use scraper::{Html, Selector};
use std::{
    collections::{HashSet, VecDeque},
    sync::Arc,
};

pub fn run(mut project: GrabberProject, engine: &Arc<Engine>) -> Result<()> {
    if project.rendered {
        project.status = "waiting_browser".into();
        engine
            .store
            .lock()
            .unwrap()
            .put("grabber", &project.id, &project)?;
        return Ok(());
    }
    project.status = "exploring".into();
    engine
        .store
        .lock()
        .unwrap()
        .put("grabber", &project.id, &project)?;
    let result = (|| -> Result<()> {
        let settings = engine.settings.lock().unwrap().clone();
        let base = security::validate_url(&project.url)?;
        let mut pending = VecDeque::from([(base.to_string(), 0)]);
        let mut visited: HashSet<_> = project.visited.iter().cloned().collect();
        let mut found: HashSet<_> = project.found.iter().map(|f| f.url.clone()).collect();
        let selector = Selector::parse(
            "a[href],img[src],video[src],audio[src],source[src],link[href],script[src]",
        )
        .unwrap();
        while let Some((url, depth)) = pending.pop_front() {
            if visited.len() >= project.max_pages
                || engine.stopping.load(std::sync::atomic::Ordering::Relaxed)
            {
                break;
            }
            if !visited.insert(url.clone()) {
                continue;
            }
            let page = match transfer::fetch_bytes(
                &url,
                &RequestContext::default(),
                &settings,
                8 * 1024 * 1024,
                None,
            ) {
                Ok((headers, bytes)) if headers.content_type.contains("html") => bytes,
                _ => continue,
            };
            let text = String::from_utf8_lossy(&page);
            let html = Html::parse_document(&text);
            let page_url = url::Url::parse(&url)?;
            for element in html.select(&selector) {
                let Some(link) = element
                    .value()
                    .attr("href")
                    .or_else(|| element.value().attr("src"))
                else {
                    continue;
                };
                let Ok(mut link) = page_url.join(link) else {
                    continue;
                };
                link.set_fragment(None);
                if security::validate_url(link.as_str()).is_err() {
                    continue;
                }
                if project.same_domain && link.host_str() != base.host_str() {
                    continue;
                }
                let text = link.to_string();
                if !project.exclude.is_empty() && matches_filter(&project.exclude, &text) {
                    continue;
                }
                let path = link.path().to_ascii_lowercase();
                let page_like = path.ends_with('/')
                    || path.rsplit('/').next().is_some_and(|n| {
                        !n.contains('.') || n.ends_with(".html") || n.ends_with(".htm")
                    });
                if page_like && depth < project.depth {
                    pending.push_back((text.clone(), depth + 1));
                }
                if (project.mirror
                    || (!page_like
                        && (project.include.is_empty() || matches_filter(&project.include, &text))))
                    && found.insert(text.clone())
                {
                    if let Ok(meta) =
                        transfer::inspect(&text, &RequestContext::default(), &settings)
                    {
                        if meta.total.is_some_and(|n| n < project.min_size)
                            || project
                                .max_size
                                .is_some_and(|max| meta.total.is_some_and(|n| n > max))
                        {
                            continue;
                        }
                        let name = security::safe_filename(
                            link.path_segments()
                                .and_then(|mut p| p.next_back())
                                .filter(|n| !n.is_empty())
                                .unwrap_or("index.html"),
                        );
                        project.found.push(GrabberFile {
                            url: text,
                            name,
                            size: meta.total,
                            content_type: meta.content_type,
                        });
                    }
                }
            }
            if project.mirror && found.insert(url.clone()) {
                project.found.push(GrabberFile {
                    url: url.clone(),
                    name: security::safe_filename(
                        page_url
                            .path_segments()
                            .and_then(|mut p| p.next_back())
                            .filter(|n| !n.is_empty())
                            .unwrap_or("index.html"),
                    ),
                    size: Some(page.len() as u64),
                    content_type: "text/html".into(),
                });
            }
            project.visited = visited.iter().cloned().collect();
            engine
                .store
                .lock()
                .unwrap()
                .put("grabber", &project.id, &project)?;
        }
        Ok(())
    })();
    project.status = match &result {
        Ok(()) => "ready".into(),
        Err(e) => format!("failed: {}", security::redact(&e.to_string())),
    };
    engine
        .store
        .lock()
        .unwrap()
        .put("grabber", &project.id, &project)?;
    result
}
fn matches_filter(filter: &str, url: &str) -> bool {
    filter.split(',').any(|pattern| {
        let pattern = regex::escape(pattern.trim())
            .replace("\\*", ".*")
            .replace("\\?", ".");
        regex::Regex::new(&format!("(?i){pattern}$")).is_ok_and(|r| r.is_match(url))
    })
}
pub fn download(engine: &Arc<Engine>, id: &str, urls: &[String]) -> Result<serde_json::Value> {
    let project = engine
        .store
        .lock()
        .unwrap()
        .all::<GrabberProject>("grabber")?
        .into_iter()
        .find(|p| p.id == id)
        .context("Unknown project")?;
    let mut jobs = vec![];
    for url in urls {
        let file = project
            .found
            .iter()
            .find(|f| &f.url == url)
            .context("File is not in the project results")?;
        jobs.push(engine.add(AddJob {
            request_id: uuid::Uuid::new_v4().to_string(),
            url: url.clone(),
            filename: Some(file.name.clone()),
            directory: Some(project.directory.clone()),
            queue: None,
            checksum: None,
            paused: false,
            context: RequestContext::default(),
            media: None,
            description: format!("Grabber: {}", project.name),
        })?);
    }
    Ok(serde_json::to_value(jobs)?)
}
