import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from prepare_legacy_access import prepare


class LegacyAccessTests(unittest.TestCase):
    def fixture(self, files):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        archive = root / 'archive.zip'
        with zipfile.ZipFile(archive, 'w') as z:
            for name, content in files.items():
                z.writestr(name, content)
        return archive, root / 'private'

    def test_matching_short_ids_and_full_raw_bytes_preserved(self):
        content = 'user_id,stimulus\nX,"<p>line one\nline two</p>"\n'
        archive, output = self.fixture({'data/user_X_Motion_final.csv': content, 'data/log.txt': 'keep'})
        report = prepare(archive, output)
        self.assertEqual(report['users'], ['X'])
        self.assertEqual(report['primary_rows'], 1)
        entry = report['entries'][0]
        self.assertEqual(entry['identity_status'], 'matched')
        self.assertEqual(entry['task'], 'Motion')
        self.assertEqual((output / entry['local_file']).read_bytes(), content.encode())
        self.assertEqual(entry['sha256'], hashlib.sha256(content.encode()).hexdigest())
        self.assertEqual(output.stat().st_mode & 0o777, 0o700)
        self.assertEqual((output / 'manifest.json').stat().st_mode & 0o777, 0o600)

    def test_identity_conflicts_are_admin_only_and_not_silently_assigned(self):
        archive, output = self.fixture({'user_Other_Motion_final.csv': 'user_id\nTest1\n'})
        report = prepare(archive, output)
        self.assertEqual(report['users'], ['Test1'])
        self.assertEqual(report['entries'][0]['identity_status'], 'conflict')
        self.assertIsNone(report['entries'][0]['user_id'])

    def test_case_collisions_rejected_before_extracting(self):
        archive, output = self.fixture({'file.csv': 'user_id\nTest1\ntest1\n'})
        with self.assertRaisesRegex(ValueError, 'collision'):
            prepare(archive, output)
        self.assertFalse(output.exists())

    def test_unsafe_paths_and_missing_identity_do_not_create_accounts(self):
        archive, output = self.fixture({'../file.csv': 'user_id\nTest1\n'})
        with self.assertRaisesRegex(ValueError, 'Unsafe'):
            prepare(archive, output)
        archive, output = self.fixture({'user_Test1_Motion_final.csv': 'rt\n123\n'})
        report = prepare(archive, output)
        self.assertEqual(report['users'], [])
        self.assertEqual(report['entries'][0]['identity_status'], 'unassigned')


if __name__ == '__main__':
    unittest.main()
