//! The end of the server's standard error (ADR-0021, Start step 4): the last 2,000 characters, decoded as UTF-8
//! with replacement characters, as the reason of a failed start (SR-252 AK5).
use std::collections::VecDeque;

/// The most characters of the reason.
pub const TAIL_CHARS: usize = 2_000;
/// Enough bytes for `TAIL_CHARS` characters of up to 4 bytes, plus the 3 bytes of a character cut at the front.
const TAIL_BYTES: usize = TAIL_CHARS * 4 + 3;

/// The last bytes of a stream, whatever the size of its chunks.
#[derive(Debug, Default)]
pub struct Tail {
    bytes: VecDeque<u8>,
}

impl Tail {
    /// Adds a chunk as it was read.
    pub fn push(&mut self, chunk: &[u8]) {
        self.bytes.extend(chunk);
        let over = self.bytes.len().saturating_sub(TAIL_BYTES);
        self.bytes.drain(..over);
    }

    /// The last `TAIL_CHARS` characters, with surrounding white space removed; `None` when nothing but white space
    /// was written.
    #[must_use]
    pub fn text(&self) -> Option<String> {
        let (front, back) = self.bytes.as_slices();
        let joined = [front, back].concat();
        let decoded = String::from_utf8_lossy(&joined);
        let trimmed = decoded.trim();
        if trimmed.is_empty() {
            return None;
        }
        let count = trimmed.chars().count();
        Some(
            trimmed
                .chars()
                .skip(count.saturating_sub(TAIL_CHARS))
                .collect::<String>()
                .trim_start()
                .to_owned(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_or_white_space_gives_no_text() {
        let mut tail = Tail::default();
        assert_eq!(tail.text(), None);
        tail.push(b" \n\t ");
        assert_eq!(tail.text(), None);
    }

    #[test]
    fn the_text_is_trimmed() {
        let mut tail = Tail::default();
        tail.push(b"\nError: cannot listen\n");
        assert_eq!(tail.text().as_deref(), Some("Error: cannot listen"));
    }

    #[test]
    fn only_the_last_2000_characters_stay_whatever_the_chunks() {
        let mut tail = Tail::default();
        for _ in 0..3_000 {
            tail.push("é".as_bytes());
        }
        tail.push("ende".as_bytes());
        let text = tail.text().unwrap();
        assert_eq!(text.chars().count(), TAIL_CHARS);
        assert!(text.ends_with("éende"));
        assert!(!text.contains('\u{fffd}'));
    }

    #[test]
    fn four_byte_characters_cut_at_the_front_leave_no_replacement_character() {
        let mut tail = Tail::default();
        for _ in 0..2_500 {
            tail.push("𝄞".as_bytes());
        }
        let text = tail.text().unwrap();
        assert_eq!(text.chars().count(), TAIL_CHARS);
        assert!(text.chars().all(|c| c == '𝄞'));
    }

    #[test]
    fn a_character_split_between_chunks_is_decoded_and_invalid_bytes_are_replaced() {
        let mut tail = Tail::default();
        let bytes = "Fehler: ü".as_bytes();
        tail.push(&bytes[..bytes.len() - 1]);
        tail.push(&bytes[bytes.len() - 1..]);
        tail.push(b" \xff!");
        assert_eq!(tail.text().as_deref(), Some("Fehler: ü \u{fffd}!"));
    }
}
