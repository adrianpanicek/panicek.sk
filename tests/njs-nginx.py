"""Exercise the actual njs module in an isolated nginx, including restart persistence."""
import concurrent.futures
import http.client
import json
import os
from pathlib import Path
import pwd
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import uuid

script = Path(sys.argv[1]).resolve()
module = os.environ.get('NJS_MODULE', '/usr/lib/nginx/modules/ngx_http_js_module.so')
nginx = os.environ.get('NGINX_PATH', 'nginx')

class UnixHTTP(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(5)
        self.sock.connect(str(root / 'http.sock'))

with tempfile.TemporaryDirectory(prefix='portfolio-njs-') as temp:
    root = Path(temp)
    root.chmod(0o755)
    shutil.copyfile(script, root / 'visitors.js')
    state = root / 'state'
    state.mkdir()
    seed = str(uuid.uuid4())
    statefile = state / 'visitors.json'
    statefile.write_text(json.dumps({seed: {'value': 7}}))
    user = pwd.getpwnam('http') if os.geteuid() == 0 else pwd.getpwuid(os.geteuid())
    if os.geteuid() == 0:
        os.chown(state, user.pw_uid, user.pw_gid)
        os.chown(statefile, user.pw_uid, user.pw_gid)
    config = root / 'nginx.conf'
    config.write_text(f'''load_module {module};
{'user ' + user.pw_name + ';' if os.geteuid() == 0 else ''}
daemon off; worker_processes 2; pid {root}/nginx.pid;
error_log {root}/error.log info;
events {{ worker_connections 128; }}
http {{ access_log off;
client_body_temp_path {root}/body;
js_import portfolioVisitors from {root}/visitors.js;
js_shared_dict_zone zone=portfolio_visitors:1m type=number state={statefile};
server {{ listen unix:{root}/http.sock;
location = /api/visit {{ client_max_body_size 4k; client_body_buffer_size 8k; js_content portfolioVisitors.visit; }}
location = /snapshot {{ js_content portfolioVisitors.snapshot; }}
}} }}''')
    process = None
    def call(identifier=seed, method='POST', origin='https://panicek.sk', payload=None, path='/api/visit'):
        connection = UnixHTTP('localhost')
        body = json.dumps({'id': identifier, 'path': '/', 'referrer': ''}) if payload is None else payload
        connection.request(method, path, body, {'Origin': origin, 'Content-Type': 'application/json'})
        response = connection.getresponse()
        result = response.status, response.read(), dict(response.getheaders())
        connection.close()
        return result
    def start():
        global process
        subprocess.run([nginx, '-p', str(root), '-c', str(config), '-t'], check=True)
        process = subprocess.Popen([nginx, '-p', str(root), '-c', str(config)], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        deadline = time.monotonic() + 5
        while True:
            try:
                assert call(method='GET')[0] == 405
                break
            except (OSError, AssertionError):
                if time.monotonic() > deadline or process.poll() is not None: raise
                time.sleep(.03)
    def stop():
        global process
        process.send_signal(signal.SIGQUIT)
        process.wait(timeout=8)
        assert process.returncode == 0
        process = None
    try:
        start()
        assert call(method='GET')[0] == 405
        assert call(origin='https://invalid.example')[0] == 403
        assert call(identifier='invalid')[0] == 400
        assert call(payload='{')[0] == 400
        assert call(payload='x' * 4097)[0] == 413
        status, body, headers = call()
        assert status == 200 and json.loads(body) == {'visitors': 1}, (status, body)
        assert headers['Cache-Control'] == 'no-store'
        identifier = str(uuid.uuid4())
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as executor:
            responses = list(executor.map(lambda _: call(identifier), range(40)))
        assert all(status == 200 and json.loads(body)['visitors'] == 2 for status, body, _ in responses)
        snapshot = json.loads(call(method='GET', path='/snapshot')[1])
        assert snapshot[identifier]['value'] == 40 and snapshot[seed]['value'] == 8
        deadline = time.monotonic() + 8
        while True:
            stored = json.loads(statefile.read_text())
            if stored.get(identifier, {}).get('value') == 40: break
            if time.monotonic() > deadline: raise AssertionError('state was not persisted')
            time.sleep(.1)
        process.send_signal(signal.SIGHUP)
        time.sleep(.3)
        assert json.loads(call(identifier.upper())[1]) == {'visitors': 2}
        stop()
        start()
        assert json.loads(call(identifier)[1]) == {'visitors': 2}
        stop()
        stored = json.loads(statefile.read_text())
        assert stored[seed]['value'] == 8
        assert stored[identifier]['value'] == 42
        print('PASS real njs validation, migrated state, concurrent deduplication, periodic persistence, reload and restart')
    except BaseException:
        if (root / 'error.log').exists(): print((root / 'error.log').read_text(), file=sys.stderr)
        raise
    finally:
        if process and process.poll() is None:
            process.send_signal(signal.SIGQUIT)
            process.wait(timeout=8)
