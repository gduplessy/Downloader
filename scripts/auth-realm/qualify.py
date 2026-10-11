"""Exercise Downloader's curl configuration against the disposable real realm."""
import hashlib
import json
import os
import pathlib
import subprocess

root = pathlib.Path('/evidence/linux')
root.mkdir(parents=True, exist_ok=True)
binary = '/build/debug/examples/qualify'
password = pathlib.Path('/run/secrets/user-password').read_text()
sha = hashlib.sha256(bytes(range(251)) * 4096).hexdigest()
os.environ['KRB5CCNAME'] = 'FILE:/tmp/downloader-fixture-ccache'
results = []


def case(name, auth, url, username, secret, rejected=False, job=False):
    directory = root / name
    directory.mkdir()
    config = {'name': name, 'mode': 'auth_job' if job else 'auth_probe', 'url': url,
              'directory': str(directory), 'username': username, 'password': secret,
              'sha256': sha, 'network': {'proxy_mode': 'direct',
              'authentication': auth, 'retries': 0}}
    if rejected:
        config['expected_failure'] = 'authentication_required'
    file = directory / 'case.json'
    file.write_text(json.dumps(config))
    file.chmod(0o600)
    try:
        run = subprocess.run([binary, str(file)], capture_output=True, text=True, timeout=45)
        if run.returncode:
            raise RuntimeError(f'{name} failed: {run.stderr.replace(password, "[REDACTED]")}')
        result = json.loads(run.stdout)
        results.append(result)
        print(json.dumps(result), flush=True)
    finally:
        file.unlink()


try:
    case('ntlm_domain_valid', 'ntlm', 'http://dc.downloader.test:8080/file.bin',
         'DOWNLOADER\\fixture', password)
    case('ntlm_domain_wrong_password', 'ntlm', 'http://dc.downloader.test:8080/file.bin',
         'DOWNLOADER\\fixture', password + '-incorrect', True)
    case('ntlm_job_valid', 'ntlm', 'http://dc.downloader.test:8080/file.bin',
         'DOWNLOADER\\fixture', password, job=True)
    case('ntlm_job_wrong_password', 'ntlm', 'http://dc.downloader.test:8080/file.bin',
         'DOWNLOADER\\fixture', password + '-incorrect', True, job=True)
    run = subprocess.run(['kinit', 'fixture@DOWNLOADER.TEST'], input=password + '\n',
                         capture_output=True, text=True, timeout=30)
    if run.returncode:
        raise RuntimeError('Disposable realm kinit failed: ' + run.stderr)
    subprocess.run(['kvno', 'HTTP/dc.downloader.test'], check=True, capture_output=True, timeout=30)
    case('kerberos_ticket_valid', 'negotiate', 'http://dc.downloader.test/protected/file.bin', '', '')
    case('kerberos_job_valid', 'negotiate', 'http://dc.downloader.test/protected/file.bin', '', '', job=True)
    subprocess.run(['kdestroy'], check=True, capture_output=True, timeout=10)
    case('kerberos_ticket_absent', 'negotiate', 'http://dc.downloader.test/protected/file.bin', '', '', True)
    case('kerberos_job_ticket_absent', 'negotiate', 'http://dc.downloader.test/protected/file.bin', '', '', True, job=True)
    bad = subprocess.run(['kinit', 'fixture@DOWNLOADER.TEST'], input=password + '-incorrect\n',
                         capture_output=True, text=True, timeout=30)
    if bad.returncode == 0 or not any(reason in bad.stderr.lower() for reason in
                                    ['password incorrect', 'preauthentication failed']):
        raise RuntimeError('Wrong Kerberos password did not produce an authentication rejection')
    results.append({'name': 'kerberos_wrong_password', 'rejected': True})
finally:
    subprocess.run(['kdestroy'], capture_output=True, timeout=10)
    (root / 'results.json').write_text(json.dumps({'platform': 'linux', 'results': results}, indent=2))
