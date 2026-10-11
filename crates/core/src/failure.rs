use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FailureCode {
    AuthenticationRequired,
    SourceExpired,
    SourceChanged,
    ResumeUnsupported,
    RangeInvalid,
    StorageFailure,
    ChecksumMismatch,
    NetworkFailure,
    ProtocolUnsupported,
    ScanFailed,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferFailure {
    pub code: FailureCode,
    pub message: String,
    pub retryable: bool,
    pub recovery: Vec<String>,
}
impl TransferFailure {
    pub fn classify(message: &str) -> Self {
        let code = if message.contains("authentication_required")
            || message.contains("HTTP 401")
            || message.contains("HTTP 407")
        {
            FailureCode::AuthenticationRequired
        } else if message.contains("source_expired")
            || message.contains("HTTP 403")
            || message.contains("HTTP 404")
            || message.contains("HTTP 410")
        {
            FailureCode::SourceExpired
        } else if message.contains("source_changed") {
            FailureCode::SourceChanged
        } else if message.contains("resume_unsupported") {
            FailureCode::ResumeUnsupported
        } else if message.contains("range_invalid") {
            FailureCode::RangeInvalid
        } else if message.contains("checksum_mismatch") {
            FailureCode::ChecksumMismatch
        } else if message.contains("scan_failed") {
            FailureCode::ScanFailed
        } else if message.contains("storage_error") {
            FailureCode::StorageFailure
        } else if message.contains("protocol_unsupported") {
            FailureCode::ProtocolUnsupported
        } else {
            FailureCode::NetworkFailure
        };
        let recovery = match code {
            FailureCode::AuthenticationRequired => vec!["update_credentials", "refresh_source"],
            FailureCode::SourceExpired => vec!["refresh_source", "refresh_in_browser"],
            FailureCode::SourceChanged
            | FailureCode::ResumeUnsupported
            | FailureCode::RangeInvalid => vec!["refresh_source", "restart"],
            FailureCode::StorageFailure => vec!["check_storage", "resume"],
            FailureCode::ChecksumMismatch => vec!["check_expected_hash", "restart"],
            FailureCode::ScanFailed => vec!["check_scanner", "resume_finalization"],
            FailureCode::ProtocolUnsupported => vec!["check_capabilities"],
            FailureCode::NetworkFailure => vec!["check_network", "resume"],
        }
        .into_iter()
        .map(String::from)
        .collect();
        Self {
            retryable: code == FailureCode::NetworkFailure,
            code,
            message: crate::security::redact(message),
            recovery,
        }
    }
}
pub fn http_error(status: u32) -> String {
    match status {
        401 | 407 => format!("authentication_required: HTTP {status}; update credentials"),
        403 | 404 | 410 => format!("source_expired: HTTP {status}; refresh the source"),
        412 => "source_changed: HTTP 412; explicitly restart changed content".into(),
        416 => "resume_unsupported: HTTP 416; refresh or explicitly restart".into(),
        _ => format!("HTTP {status}"),
    }
}
