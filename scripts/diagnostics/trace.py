"""Read complete JSONL records while the diagnostic writer may still append."""
import json


def read_trace_rows(path):
    # The newline commits a row. A copy can end inside JSON or a UTF-8 character.
    return [json.loads(line) for line in path.read_bytes().split(b"\n")[:-1] if line.strip()]
