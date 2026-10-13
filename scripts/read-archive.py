#!/usr/bin/env python3
"""One-time legacy reader. Live experiment ingestion never imports this module."""
import base64
import csv
import hashlib
import io
import json
import re
import sys
import zipfile

csv.field_size_limit(32 * 1024 * 1024)
pattern = re.compile(r'user_(.+?)_(Motion|Orientation|Centrality|Bar)_(?:session\d+_)?(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})')


def entries(archive):
    with zipfile.ZipFile(archive) as z:
        names = set()
        for info in z.infolist():
            if info.is_dir():
                continue
            if info.filename in names:
                raise ValueError(f'Duplicate archive path: {info.filename}')
            names.add(info.filename)
            if info.file_size > 64 * 1024 * 1024:
                raise ValueError(f'Archive entry too large: {info.filename}')
            raw = z.read(info)  # zipfile also verifies the entry's CRC.
            kind = 'csv' if info.filename.endswith('.csv') else 'backup' if '.csv.' in info.filename else 'artifact'
            header, rows = None, []
            if kind in ('csv', 'backup'):
                reader = csv.reader(io.StringIO(raw.decode('utf-8-sig'), newline=''), strict=True)
                header = next(reader, [])
                if len(header) != len(set(header)):
                    raise ValueError(f'Duplicate CSV column: {info.filename}')
                for ordinal, cells in enumerate(reader, 1):
                    if not cells:
                        continue  # An empty physical line contains no data record.
                    if len(cells) != len(header):
                        raise ValueError(f'Column count mismatch: {info.filename}, row {ordinal}')
                    rows.append(dict(zip(header, cells)))
            match = pattern.search(info.filename)
            user_id, task, timestamp = match.groups() if match else (None, None, None)
            yield {'path': info.filename, 'sha256': hashlib.sha256(raw).hexdigest(), 'kind': kind,
                   'user_id': user_id, 'task': task, 'run_timestamp': timestamp,
                   'header': header, 'rows': rows, 'bytes': base64.b64encode(raw).decode('ascii')}


if __name__ == '__main__':
    for entry in entries(sys.argv[1]):
        print(json.dumps(entry, ensure_ascii=True, separators=(',', ':')), flush=True)
