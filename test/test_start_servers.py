"""Exercise the actual launchers with fake build/process managers; no deployments."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ('start-server.sh', 'aws-start-server.sh', 'ocular-start-server-legacy.sh')
STUB = '''#!/usr/bin/env python3
import json, os, pathlib, shutil, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ['LAUNCH_LOG'], 'a') as log:
    log.write(json.dumps([name, args, os.getcwd(), os.environ.get('PORT')]) + '\\n')
if name == 'npm':
    if os.environ.get('BUILD_FAIL') == '1': sys.exit(7)
    dist = pathlib.Path('dist')
    if dist.exists(): shutil.rmtree(dist)
    for entry in ('index.html', 'data-portal/index.html', 'data-portal/users.html', 'data-portal/preview.html'):
        target = dist / entry
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text('compiled ' + entry)
    if os.environ.get('INCOMPLETE_BUILD') == '1': (dist / 'data-portal/users.html').unlink()
elif name == 'node':
    if args[0] == '-e': sys.exit(0)
elif name == 'pm2' and args[0] == 'describe':
    sys.exit(0 if os.environ.get('EXISTING_SERVICE') == '1' else 1)
elif name == 'tmux' and args[0] == 'has-session':
    sys.exit(0 if os.environ.get('EXISTING_SERVICE') == '1' else 1)
'''


class StartServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='view recovery ')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'scripts').mkdir()
        shutil.copy(ROOT / 'scripts/server-common.sh', self.root / 'scripts')
        shutil.copy(ROOT / 'scripts/serve-built.mjs', self.root / 'scripts')
        for name in SCRIPTS:
            shutil.copy(ROOT / name, self.root)
        for dependency in ('serve-handler/package.json', 'vite/bin/vite.js'):
            target = self.root / 'node_modules' / dependency
            target.parent.mkdir(parents=True, exist_ok=True)
            target.touch()
        (self.root / 'dist/data').mkdir(parents=True)
        (self.root / 'dist/data/legacy.csv').write_text('preserve me')
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        for name in ('node', 'npm', 'pm2', 'tmux', 'cloudflared'):
            target = self.bin / name
            target.write_text(STUB)
            target.chmod(0o755)
        self.log = self.root / 'calls.jsonl'
        self.env = dict(os.environ, PATH=f'{self.bin}:{os.environ["PATH"]}', LAUNCH_LOG=str(self.log))
        for key in ('HOST', 'PORT', 'PM2_NAME', 'SESSION', 'TUNNEL_NAME'):
            self.env.pop(key, None)

    def launch(self, script, **env):
        return subprocess.run(['bash', str(self.root / script)], cwd='/tmp',
                              env=dict(self.env, **env), capture_output=True, text=True)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def test_all_launchers_build_from_any_directory_and_preserve_legacy_data(self):
        for script, port in zip(SCRIPTS, (5173, 8001, 8002)):
            with self.subTest(script=script):
                result = self.launch(script)
                self.assertEqual(result.returncode, 0, result.stderr)
                calls = self.calls()
                self.assertTrue(any(c[:2] == ['npm', ['run', 'build']] for c in calls))
                command_text = json.dumps(calls)
                self.assertTrue(any(c[3] == str(port) for c in calls))
                self.assertIn('serve-built.mjs', command_text)
                self.assertNotIn('save_data.php', command_text)
                self.assertFalse((self.root / 'dist/data').exists())
                self.assertEqual((self.root / 'dist/data-portal/index.html').read_text(), 'compiled data-portal/index.html')
                self.assertEqual(list((self.root / 'data').glob('*/legacy.csv'))[0].read_text(), 'preserve me')
                self.log.unlink()

    def test_failed_build_does_not_stop_services_or_launch_server(self):
        for script in SCRIPTS:
            with self.subTest(script=script):
                result = self.launch(script, BUILD_FAIL='1', EXISTING_SERVICE='1')
                self.assertEqual(result.returncode, 7)
                self.assertTrue(all(c[0] in ('node', 'npm') for c in self.calls()))
                self.assertEqual((self.root / 'dist/data/legacy.csv').read_text(), 'preserve me')
                self.log.unlink()

    def test_existing_managers_replaced_after_build_and_custom_options_quoted(self):
        for script in SCRIPTS[1:]:
            with self.subTest(script=script):
                result = self.launch(script, EXISTING_SERVICE='1', PORT='9001', SESSION='custom session', PM2_NAME='custom process', TUNNEL_NAME='custom tunnel')
                self.assertEqual(result.returncode, 0, result.stderr)
                calls = self.calls()
                build = next(i for i, c in enumerate(calls) if c[0] == 'npm')
                stopped = next(i for i, c in enumerate(calls) if c[1][0] in ('delete', 'kill-session'))
                self.assertGreater(stopped, build)
                self.assertTrue(any(c[3] == '9001' for c in calls))
                if script.startswith('ocular'):
                    start = next(c for c in calls if c[1][0] == 'new-session')
                    self.assertIn(str(self.root), start[1])
                    self.assertIn('\\ ', start[1][-1])
                    self.assertIn('custom session', start[1])
                self.log.unlink()

    def test_invalid_ports_rejected_before_build(self):
        for port in ('0', '65536', '-1', 'abc', '999999999999999999'):
            with self.subTest(port=port):
                result = self.launch(SCRIPTS[0], PORT=port)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('PORT must', result.stderr)
                self.assertFalse(any(c[0] == 'npm' for c in self.calls()))
                self.log.unlink()

    def test_backup_failure_prevents_build_and_restart(self):
        shutil.rmtree(self.root / 'data', ignore_errors=True)
        (self.root / 'data').write_text('blocks backup directory')
        result = self.launch(SCRIPTS[1], EXISTING_SERVICE='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(c[0] in ('npm', 'pm2') for c in self.calls()))

    def test_incomplete_build_prevents_restart(self):
        result = self.launch(SCRIPTS[2], EXISTING_SERVICE='1', INCOMPLETE_BUILD='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('all application entry points', result.stderr)
        self.assertFalse(any(c[0] == 'tmux' for c in self.calls()))

    def test_missing_dependencies_prevent_build(self):
        (self.root / 'node_modules/serve-handler/package.json').unlink()
        result = self.launch(SCRIPTS[0])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('npm ci', result.stderr)
        self.assertFalse(any(c[0] == 'npm' for c in self.calls()))


if __name__ == '__main__':
    unittest.main()
