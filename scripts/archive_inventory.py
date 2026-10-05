"""Read-only archive inventory. No participant cells are emitted in the report."""
import csv
import hashlib
import io
import json
import stat
import zipfile
from collections import Counter
from pathlib import Path, PurePosixPath


def inventory(path, max_bytes=500_000_000):
    path = Path(path)
    entries, headers, types = [], Counter(), Counter()
    primary_rows = backup_rows = total = 0
    with zipfile.ZipFile(path) as archive:
        names = set()
        for entry in archive.infolist():
            name = entry.filename
            normalized = PurePosixPath(name)
            if '\\' in name or normalized.is_absolute() or '..' in normalized.parts or name in names:
                raise ValueError('Unsafe or duplicate archive path')
            names.add(name)
            if stat.S_ISLNK(entry.external_attr >> 16):
                raise ValueError('Archive symlink rejected')
            if entry.is_dir():
                continue
            total += entry.file_size
            if total > max_bytes:
                raise ValueError('Archive expansion limit exceeded')
            content = archive.read(entry)
            suffix = Path(name).suffix.lower()
            kind = suffix or 'extensionless'
            types[kind] += 1
            item = {'path': name, 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest(), 'kind': kind}
            if suffix in ('.csv', '.bak'):
                try:
                    reader = csv.DictReader(io.StringIO(content.decode('utf-8-sig'), newline=''))
                    header = tuple(reader.fieldnames or ())
                    if not header or len(header) != len(set(header)):
                        raise ValueError('Missing or duplicate CSV header')
                    count = 0
                    for row in reader:
                        if None in row or any(value is None for value in row.values()):
                            raise ValueError('CSV row shape mismatch')
                        count += 1
                    item['rows'] = count
                    item['header_sha256'] = hashlib.sha256(json.dumps(header).encode()).hexdigest()
                    if suffix == '.csv':
                        primary_rows += count
                        headers[header] += 1
                    else:
                        backup_rows += count
                except (UnicodeError, csv.Error, ValueError) as error:
                    item['parse_error'] = str(error)
            entries.append(item)
    return {'archive_sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'file_count': len(entries),
            'uncompressed_bytes': total, 'types': dict(sorted(types.items())), 'primary_rows': primary_rows,
            'backup_rows': backup_rows, 'primary_header_variants': len(headers), 'entries': entries}


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('archive')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    Path(args.output).write_text(json.dumps(inventory(args.archive), indent=2) + '\n')
