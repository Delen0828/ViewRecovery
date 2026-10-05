import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('inventory', 'scripts/archive_inventory.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class InventoryTests(unittest.TestCase):
    def archive(self, entries):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = Path(tmp.name) / 'fixture.zip'
        with zipfile.ZipFile(path, 'w') as archive:
            for name, data in entries.items():
                archive.writestr(name, data)
        return path

    def test_multiline_csv_and_backup_are_separate(self):
        result = module.inventory(self.archive({'a.csv': 'id,text\n1,"a\nb"\n', 'a.bak': 'id,text\n1,old\n', 'log.txt': 'log'}))
        self.assertEqual((result['file_count'], result['primary_rows'], result['backup_rows']), (3, 1, 1))
        self.assertEqual(len(result['entries'][0]['sha256']), 64)

    def test_unsafe_paths_and_expansion(self):
        for name in ['../secret', '/secret', 'a\\b']:
            with self.assertRaises(ValueError):
                module.inventory(self.archive({name: 'x'}))
        with self.assertRaises(ValueError):
            module.inventory(self.archive({'a': '1234'}), max_bytes=3)

    def test_bad_csv_retained_with_error(self):
        result = module.inventory(self.archive({'bad.csv': 'a,b\n1,2,3\n'}))
        self.assertIn('parse_error', result['entries'][0])
        self.assertEqual(result['file_count'], 1)

    def test_actual_archive_matches_plan(self):
        result = module.inventory('server-data.zip')
        self.assertEqual((result['file_count'], result['primary_rows'], result['primary_header_variants']), (419, 144369, 14))
        self.assertEqual(result['uncompressed_bytes'], 225727596)
        self.assertEqual(result['types']['.csv'], 406)
        self.assertEqual(result['types']['.bak'], 9)
        self.assertFalse(any('parse_error' in e for e in result['entries'] if e['kind'] == '.csv'))
