from __future__ import annotations

import json
from dataclasses import dataclass
from typing import List, Sequence, Tuple

Token = Tuple[int, int, int]


@dataclass
class Compressor:
    """
    Starter template for a lossless LZ-style compressor.

    Token format:
    - (distance, length, next_byte)
    - distance: how far back to copy from output buffer
    - length: number of bytes to copy
    - next_byte: literal byte value appended after the copy

    You can replace token format if compress/decompress stay lossless.
    """

    window_size: int = 64
    max_match_length: int = 16

    def compress(self, data: bytes) -> bytes:
        """Turn raw bytes into compressed bytes."""
        if not data:
            return b""

        tokens: List[Token] = []
        i = 0
        while i < len(data):
            distance, length = self.find_longest_match(data, i)
            next_index = i + length
            next_byte = data[next_index] if next_index < len(data) else 0
            tokens.append((distance, length, next_byte))
            i += length + 1

        return self.encode_tokens(tokens)

    def decompress(self, blob: bytes) -> bytes:
        """Recover original bytes from compressed bytes."""
        if not blob:
            return b""

        tokens = self.decode_tokens(blob)
        out = bytearray()

        for distance, length, next_byte in tokens:
            self.apply_back_reference(out, distance, length)
            if next_byte != 0:
                out.append(next_byte)

        return bytes(out)

    def find_longest_match(self, data: bytes, start: int) -> Tuple[int, int]:
        """
        Return (distance, length) for the best match that ends before start.

        TODO:
        1. Search in a sliding window ending at `start`.
        2. Find the longest matching prefix against future bytes.
        3. Return (0, 0) when no useful match is found.
        """
        _ = data
        _ = start
        return (0, 0)

    def apply_back_reference(self, out: bytearray, distance: int, length: int) -> None:
        """Copy `length` bytes from `distance` bytes behind current output."""
        if distance <= 0 or length <= 0:
            return

        src = len(out) - distance
        for _ in range(length):
            out.append(out[src])
            src += 1

    def encode_tokens(self, tokens: Sequence[Token]) -> bytes:
        """
        Convert token list to bytes.

        This simple JSON encoding is easy to debug.
        You may replace this with a compact binary format.
        """
        serializable = [[d, l, n] for d, l, n in tokens]
        return json.dumps(serializable, separators=(",", ":")).encode("utf-8")

    def decode_tokens(self, blob: bytes) -> List[Token]:
        """Inverse of encode_tokens."""
        raw = json.loads(blob.decode("utf-8"))
        return [(int(d), int(l), int(n)) for d, l, n in raw]
