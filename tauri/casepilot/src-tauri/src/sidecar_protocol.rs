use std::io;

use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt};

pub const MAX_FRAME_BYTES: usize = 32 * 1024 * 1024;

/// Read one JSON-lines frame, bounding the allocation even if the writer never sends a newline.
pub async fn read_frame(
    reader: &mut (impl AsyncBufRead + Unpin),
    frame: &mut Vec<u8>,
    max_bytes: usize,
) -> io::Result<bool> {
    frame.clear();
    // Read one extra byte to distinguish a valid frame at the limit from an oversized one.
    let count = reader
        .take(max_bytes as u64 + 1)
        .read_until(b'\n', frame)
        .await?;
    if count > max_bytes && !frame.ends_with(b"\n") {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "sidecar frame exceeded its size limit",
        ));
    }
    Ok(count > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::BufReader;

    #[test]
    fn reads_multiple_frames_and_preserves_a_final_frame_without_a_newline() {
        tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap()
            .block_on(async {
                let mut reader = BufReader::with_capacity(2, &b"1234\nab\nlast"[..]);
                let mut frame = Vec::new();
                for expected in [b"1234\n".as_slice(), b"ab\n", b"last"] {
                    assert!(read_frame(&mut reader, &mut frame, 4).await.unwrap());
                    assert_eq!(frame, expected);
                }
                assert!(!read_frame(&mut reader, &mut frame, 4).await.unwrap());
            });
    }

    #[test]
    fn rejects_oversized_and_unterminated_frames_without_reading_the_rest() {
        tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap()
            .block_on(async {
                for input in [b"123456789\n".as_slice(), b"123456789"] {
                    let mut reader = BufReader::with_capacity(2, input);
                    let mut frame = Vec::new();
                    let error = read_frame(&mut reader, &mut frame, 4).await.unwrap_err();
                    assert_eq!(error.kind(), io::ErrorKind::InvalidData);
                    assert_eq!(frame, b"12345");
                }
            });
    }
}
