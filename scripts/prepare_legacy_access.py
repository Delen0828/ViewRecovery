"""Prepare a private, lossless archive manifest for account/artifact provisioning."""
import csv
import io
import json
from pathlib import Path
import re
import zipfile
from archive_inventory import inventory


def prepare(archive_path, output):
    report = inventory(archive_path)
    users = set()
    for entry in report['entries']:
        entry['user_id'] = None
        entry['task'] = None
        entry['identity_status'] = 'unassigned'
    with zipfile.ZipFile(archive_path) as archive:
        for entry in report['entries']:
            if entry['kind'] not in ('.csv', '.bak') or entry.get('parse_error'):
                continue
            rows = csv.DictReader(io.StringIO(archive.read(entry['path']).decode('utf-8-sig'), newline=''))
            identities = {row.get('user_id', '').strip() for row in rows if row.get('user_id', '').strip()}
            users.update(identities)
            base = entry['path'].rsplit('/', 1)[-1]
            match = re.search(r'(?:^|_)user_([^_]+)_', base, re.I)
            filename_id = match.group(1) if match else None
            task = re.search(r'(?:^|_)user_[^_]+_([A-Za-z]+)(?:_|\.csv$)', base, re.I)
            if task:
                entry['task'] = next((t for t in ('Motion', 'Orientation', 'Centrality', 'Bar') if t.lower() == task.group(1).lower()), None)
            if len(identities) == 1 and (not filename_id or identities == {filename_id}):
                entry['user_id'] = next(iter(identities))
                entry['identity_status'] = 'matched' if filename_id else 'row-only'
            elif identities:
                entry['identity_status'] = 'conflict'
            # Filenames alone never grant ownership of rows.
    if any(not re.fullmatch(r'[A-Za-z0-9]{1,32}', user) for user in users):
        raise ValueError('Unsupported legacy identity')
    if len(users) != len({user.lower() for user in users}):
        raise ValueError('Case-insensitive legacy identity collision')
    report['users'] = sorted(users, key=str.lower)
    report['mapping_version'] = 'legacy-access-v1'
    output = Path(output)
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    output.chmod(0o700)
    # Opaque numbered filenames prevent unsafe extraction and disclose no IDs.
    with zipfile.ZipFile(archive_path) as archive:
        for index, entry in enumerate(report['entries']):
            entry['local_file'] = f'{index:04d}.bin'
            target = output / entry['local_file']
            target.write_bytes(archive.read(entry['path']))
            target.chmod(0o600)
    manifest = output / 'manifest.json'
    manifest.write_text(json.dumps(report) + '\n')
    manifest.chmod(0o600)
    return report


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('archive')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    result = prepare(args.archive, args.output)
    print(json.dumps({'files': result['file_count'], 'users': len(result['users']),
                      'primary_rows': result['primary_rows'],
                      'identity_conflicts': sum(e['identity_status'] == 'conflict' for e in result['entries'])}))
