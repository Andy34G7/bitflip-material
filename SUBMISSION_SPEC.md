# Compressor Submission Spec

Each submitted repository must expose one class with this API:

- File path: `compressor.py` (default)
- Class name: `Compressor` (default)
- Methods:
  - `compress(self, data: bytes) -> bytes`
  - `decompress(self, blob: bytes) -> bytes`

## Rules

1. Compression must be lossless:
   - `decompress(compress(data)) == data`
2. Input/output must be bytes.
3. Keep runtime reasonable for files up to a few KB in benchmark mode.

## Recommended Scaffold

Copy this file from teacher repo:

- `templates/compressor_template.py`

Then rename or place it as `compressor.py` in the submitted repository.

## Submission Manifest Entry

Update `submissions.json` with one row per repo:

```json
{
  "name": "jane-doe",
  "repo": "https://github.com/org-or-user/jane-compressor",
  "branch": "main",
  "module": "compressor.py",
  "class": "Compressor"
}
```
