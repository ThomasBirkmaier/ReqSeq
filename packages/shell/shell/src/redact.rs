//! The token in the shell's own output (ADR-0021, Start step 6; SR-252 AK2): the engine's processes inherit the
//! shell's standard output and error, so every line written there is copied with the token replaced.
use std::io::{self, BufRead, Write};
use std::sync::{Arc, OnceLock};

/// What stands in the output instead of the token.
pub const REPLACEMENT: &[u8] = b"<token>";

/// The token once the server printed it; shared by the filter threads and the shell.
pub type TokenSlot = Arc<OnceLock<Vec<u8>>>;

/// `line` with every occurrence of `token` replaced.
#[must_use]
pub fn redact(line: &[u8], token: Option<&[u8]>) -> Vec<u8> {
    let Some(token) = token.filter(|t| !t.is_empty()) else {
        return line.to_vec();
    };
    let mut out = Vec::with_capacity(line.len());
    let mut rest = line;
    while let Some(at) = rest.windows(token.len()).position(|w| w == token) {
        out.extend_from_slice(&rest[..at]);
        out.extend_from_slice(REPLACEMENT);
        rest = &rest[at + token.len()..];
    }
    out.extend_from_slice(rest);
    out
}

/// Copies `input` line by line to `output` until its end, each line redacted with the token known at that moment.
/// A token never holds a line break, so a whole line always holds a whole token.
///
/// # Errors
///
/// A failed read; a failed write ends the copy quietly, since nobody reads the output any more.
pub fn copy_lines(input: &mut dyn BufRead, output: &mut dyn Write, token: &TokenSlot) -> io::Result<()> {
    let mut line = Vec::new();
    loop {
        line.clear();
        if input.read_until(b'\n', &mut line)? == 0 {
            return Ok(());
        }
        let text = redact(&line, token.get().map(Vec::as_slice));
        // A failed write is dropped, and the reading goes on, so the writers never block on a full pipe.
        let _ = output.write_all(&text);
        let _ = output.flush();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_occurrence_of_the_token_is_replaced() {
        assert_eq!(
            redact(b"a TOK b TOKTOK\n", Some(b"TOK")),
            b"a <token> b <token><token>\n".to_vec()
        );
        assert_eq!(redact(b"no token here", Some(b"TOK")), b"no token here".to_vec());
    }

    #[test]
    fn without_a_token_lines_stay_as_they_are() {
        assert_eq!(redact(b"line TOK\n", None), b"line TOK\n".to_vec());
        assert_eq!(redact(b"line\n", Some(b"")), b"line\n".to_vec());
    }

    #[test]
    fn lines_are_copied_with_the_token_known_when_each_is_read() {
        let token: TokenSlot = Arc::default();
        let mut out = Vec::new();
        copy_lines(&mut &b"TOK one\n"[..], &mut out, &token).unwrap();
        token.set(b"TOK".to_vec()).unwrap();
        copy_lines(&mut &b"TOK two\nlast TOK"[..], &mut out, &token).unwrap();
        assert_eq!(out, b"TOK one\n<token> two\nlast <token>".to_vec());
    }

    struct Closed;
    impl Write for Closed {
        fn write(&mut self, _: &[u8]) -> io::Result<usize> {
            Err(io::Error::from(io::ErrorKind::BrokenPipe))
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn a_closed_output_is_read_to_the_end() {
        let token: TokenSlot = Arc::default();
        let mut input = &b"one\ntwo\n"[..];
        copy_lines(&mut input, &mut Closed, &token).unwrap();
        assert!(input.is_empty());
        assert!(Closed.flush().is_ok());
    }

    struct Broken;
    impl io::Read for Broken {
        fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
            Err(io::Error::other("read failed"))
        }
    }

    #[test]
    fn a_failed_read_is_returned() {
        let token: TokenSlot = Arc::default();
        let error = copy_lines(&mut io::BufReader::new(Broken), &mut Vec::new(), &token).unwrap_err();
        assert_eq!(error.to_string(), "read failed");
    }
}
