//! Addresses (ADR-0021, Start step 4 and Opening an address): the line the server prints, and which address a
//! page may hand on to the operating system (SR-252 AK3).
use std::net::Ipv6Addr;
use url::{Host, Url};

/// The start of the line in which `reqseq ui` prints its address (ADR-0020).
pub const LINE_PREFIX: &str = "ReqSeq UI on ";

/// The address the server printed: `http://` on a loopback host with a port, carrying `#token=`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerAddress {
    url: Url,
    port: u16,
    token: String,
}

impl ServerAddress {
    /// The address of a line of the server's standard output. `None` for a line that is not the address line.
    ///
    /// # Errors
    ///
    /// The line starts as the address line, but its address is not one the shell loads (SR-252 AK5).
    pub fn from_line(line: &str) -> Result<Option<Self>, String> {
        let Some(rest) = line.trim_end_matches(['\r', '\n']).strip_prefix(LINE_PREFIX) else {
            return Ok(None);
        };
        Self::parse(rest.trim()).map(Some)
    }

    fn parse(text: &str) -> Result<Self, String> {
        let refused = || format!("printed an address that is not a loopback address with a token: {text}");
        let url = Url::parse(text).map_err(|_| refused())?;
        let port = url.port().ok_or_else(refused)?;
        let token = url
            .fragment()
            .and_then(|f| f.strip_prefix("token="))
            .unwrap_or("")
            .to_owned();
        let loopback = url.host().is_some_and(|host| is_loopback(&host));
        if url.scheme() != "http" || !loopback || token.is_empty() {
            return Err(refused());
        }
        Ok(Self { url, port, token })
    }

    /// The whole address, with the token.
    #[must_use]
    pub fn url(&self) -> &Url {
        &self.url
    }

    #[must_use]
    pub fn port(&self) -> u16 {
        self.port
    }

    #[must_use]
    pub fn token(&self) -> &str {
        &self.token
    }

    /// The origin as printed: scheme, host and port, such as `http://127.0.0.1:43123`.
    #[must_use]
    pub fn origin(&self) -> String {
        self.url.origin().ascii_serialization()
    }

    /// Whether the window may load `url`: only the origin of this address (ADR-0021, The window loads only its
    /// server).
    #[must_use]
    pub fn same_origin(&self, url: &Url) -> bool {
        url.origin() == self.url.origin()
    }
}

/// 127.0.0.0/8, `::1`, IPv4-mapped 127.0.0.0/8, or `localhost`.
fn is_loopback(host: &Host<&str>) -> bool {
    match host {
        Host::Domain(name) => name.eq_ignore_ascii_case("localhost"),
        Host::Ipv4(ip) => ip.is_loopback(),
        Host::Ipv6(ip) => {
            *ip == Ipv6Addr::LOCALHOST || ip.to_ipv4_mapped().is_some_and(|v4| v4.is_loopback())
        }
    }
}

/// What the shell does with an address a page asks it to open (SR-252 AK3).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Open {
    /// Hand it, in its parsed form, to the opener of the operating system.
    HandOn(Url),
    /// Start nothing; the reason is for the page.
    Refused(&'static str),
}

/// The rule of SR-252 AK3: an absolute http or https address with a host, or a mailto address, that is not the own
/// server (a loopback host or `localhost` on `server_port`; a missing port is the scheme's default) is handed on;
/// everything else is refused.
#[must_use]
pub fn decide(input: &str, server_port: u16) -> Open {
    let Ok(url) = Url::parse(input) else {
        return Open::Refused("not a full address");
    };
    match url.scheme() {
        "mailto" => Open::HandOn(url),
        // An http or https address always has a host once parsed.
        "http" | "https" => {
            if url.host().is_some_and(|host| is_loopback(&host))
                && url.port_or_known_default() == Some(server_port)
            {
                Open::Refused("an address of the shell's own server")
            } else {
                Open::HandOn(url)
            }
        }
        _ => Open::Refused("only http, https and mailto addresses are opened"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "AbC-123_x";

    fn line(address: &str) -> String {
        format!("{LINE_PREFIX}{address}\n")
    }

    #[test]
    fn the_address_line_gives_the_address_its_port_token_and_origin() {
        let address = ServerAddress::from_line(&line(&format!("http://127.0.0.1:43123/#token={TOKEN}")))
            .unwrap()
            .unwrap();
        assert_eq!(address.port(), 43123);
        assert_eq!(address.token(), TOKEN);
        assert_eq!(address.origin(), "http://127.0.0.1:43123");
        assert_eq!(
            address.url().as_str(),
            format!("http://127.0.0.1:43123/#token={TOKEN}")
        );
        assert!(address.same_origin(&Url::parse("http://127.0.0.1:43123/api/x#y").unwrap()));
        assert!(!address.same_origin(&Url::parse("http://127.0.0.1:43124/").unwrap()));
        assert!(!address.same_origin(&Url::parse("http://localhost:43123/").unwrap()));
        assert!(!address.same_origin(&Url::parse("https://127.0.0.1:43123/").unwrap()));
    }

    #[test]
    fn other_lines_are_no_address() {
        assert_eq!(ServerAddress::from_line("Stop with Ctrl-C.\n"), Ok(None));
        assert_eq!(ServerAddress::from_line(""), Ok(None));
    }

    #[test]
    fn localhost_and_ipv6_loopback_are_loopback_hosts() {
        for host in [
            "localhost",
            "LOCALHOST",
            "[::1]",
            "127.9.9.9",
            "[::ffff:127.0.0.1]",
        ] {
            let text = line(&format!("http://{host}:5000/#token={TOKEN}"));
            assert!(ServerAddress::from_line(&text).unwrap().is_some(), "{host}");
        }
    }

    #[test]
    fn an_address_line_with_another_address_is_refused() {
        for address in [
            format!("https://127.0.0.1:5000/#token={TOKEN}"),
            format!("http://192.0.2.1:5000/#token={TOKEN}"),
            format!("http://[2001:db8::1]:5000/#token={TOKEN}"),
            format!("http://example.org:5000/#token={TOKEN}"),
            format!("http://127.0.0.1/#token={TOKEN}"),
            "http://127.0.0.1:5000/".to_owned(),
            "http://127.0.0.1:5000/#token=".to_owned(),
            "http://127.0.0.1:5000/#other=1".to_owned(),
            "not an address".to_owned(),
        ] {
            let error = ServerAddress::from_line(&line(&address)).unwrap_err();
            assert!(error.contains("not a loopback address"), "{address}: {error}");
        }
    }

    /// What happens to `input` next to a server on port 43123: the address handed on, or the reason.
    fn open(input: &str) -> Result<String, &'static str> {
        match decide(input, 43123) {
            Open::HandOn(url) => Ok(url.to_string()),
            Open::Refused(reason) => Err(reason),
        }
    }

    fn handed(input: &str) -> String {
        open(input).unwrap_or_default()
    }

    fn refused(input: &str) -> &'static str {
        open(input).err().unwrap_or_default()
    }

    #[test]
    fn http_https_and_mailto_addresses_are_handed_on_in_their_parsed_form() {
        assert_eq!(handed("https://example.org/a b"), "https://example.org/a%20b");
        assert_eq!(handed("HTTP://Example.org"), "http://example.org/");
        assert_eq!(handed("HtTpS://example.org/x?y#z"), "https://example.org/x?y#z");
        assert_eq!(handed("MAILTO:someone@example.org"), "mailto:someone@example.org");
        assert_eq!(handed("http://192.0.2.1:43123/"), "http://192.0.2.1:43123/");
    }

    #[test]
    fn loopback_addresses_on_another_port_and_localhost_subdomains_are_not_the_own_server() {
        assert_eq!(handed("http://127.0.0.1:43124/"), "http://127.0.0.1:43124/");
        assert_eq!(handed("http://127.0.0.1/"), "http://127.0.0.1/");
        assert_eq!(
            handed("http://app.localhost:43123/"),
            "http://app.localhost:43123/"
        );
    }

    #[test]
    fn the_own_server_is_refused_in_every_spelling() {
        for input in [
            "http://127.0.0.1:43123/",
            "http://127.0.0.1:43123/#token=abc",
            "https://127.0.0.1:43123/",
            "http://127.1:43123/",
            "http://0x7f.0.0.1:43123/",
            "http://2130706433:43123/",
            "http://127.200.0.9:43123/x",
            "http://localhost:43123/",
            "http://LocalHost:43123/",
            "http://[::1]:43123/",
            "http://[::ffff:127.0.0.1]:43123/",
            "http://[::ffff:7f00:1]:43123/",
        ] {
            assert_eq!(refused(input), "an address of the shell's own server", "{input}");
        }
        assert_eq!(
            decide("http://127.0.0.1/", 80),
            Open::Refused("an address of the shell's own server")
        );
        assert_eq!(
            decide("https://localhost/", 443),
            Open::Refused("an address of the shell's own server")
        );
    }

    #[test]
    fn other_schemes_relative_and_empty_addresses_are_refused() {
        for input in ["", " ", "example.org", "/x", "#/e/SR-1", "//example.org/"] {
            assert_eq!(refused(input), "not a full address", "{input:?}");
        }
        for input in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "ftp://example.org/",
            "data:text/html,x",
            "tauri://localhost",
        ] {
            assert_eq!(
                refused(input),
                "only http, https and mailto addresses are opened",
                "{input}"
            );
        }
        // WHATWG parsing makes `http:x` the full address `http://x/`.
        assert_eq!(handed("http:x"), "http://x/");
    }
}
