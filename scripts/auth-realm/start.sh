#!/bin/bash
set -euo pipefail
umask 077
test -s /run/secrets/admin-password
test -s /run/secrets/user-password
admin_password=$(cat /run/secrets/admin-password)
user_password=$(cat /run/secrets/user-password)
rm -f /etc/samba/smb.conf
samba-tool domain provision --realm=DOWNLOADER.TEST --domain=DOWNLOADER \
    --server-role=dc --dns-backend=SAMBA_INTERNAL --host-name=dc \
    --adminpass="$admin_password" --use-rfc2307 \
    --option='acl_xattr:security_acl_name=user.NTACL' > /tmp/provision.log 2>&1
unset admin_password
cat > /etc/krb5.conf <<'EOF'
[libdefaults]
 default_realm = DOWNLOADER.TEST
 dns_lookup_realm = false
 dns_lookup_kdc = false
 rdns = false
[realms]
 DOWNLOADER.TEST = {
  kdc = dc.downloader.test
  admin_server = dc.downloader.test
 }
[domain_realm]
 .downloader.test = DOWNLOADER.TEST
 downloader.test = DOWNLOADER.TEST
EOF
chmod 644 /etc/krb5.conf
samba-tool user create fixture "$user_password" > /tmp/user.log 2>&1
unset user_password
samba-tool spn add HTTP/dc.downloader.test fixture
samba-tool domain exportkeytab /etc/apache2/http.keytab --principal=HTTP/dc.downloader.test@DOWNLOADER.TEST
klist -k /etc/apache2/http.keytab > /tmp/keytab-info.log
grep -q 'HTTP/dc.downloader.test@DOWNLOADER.TEST' /tmp/keytab-info.log
chown www-data:www-data /etc/apache2/http.keytab
chmod 600 /etc/apache2/http.keytab
mkdir -p /var/www/html/protected
python3 - <<'PY'
from pathlib import Path
data = bytes(range(251)) * 4096
Path('/var/www/html/protected/file.bin').write_bytes(data)
PY
chmod 755 /var/www/html/protected
chmod 644 /var/www/html/protected/file.bin
cat > /etc/apache2/sites-available/000-default.conf <<'EOF'
ServerName dc.downloader.test
<VirtualHost *:80>
 DocumentRoot /var/www/html
 <Location /protected>
  AuthType GSSAPI
  AuthName "Downloader disposable realm"
  GssapiCredStore keytab:/etc/apache2/http.keytab
  GssapiAllowedMech krb5
  GssapiBasicAuth Off
  GssapiSSLonly Off
  Require valid-user
 </Location>
</VirtualHost>
EOF
samba -i > /tmp/samba.log 2>&1 &
samba_pid=$!
for attempt in $(seq 1 60); do
    if wbinfo --ping-dc >/dev/null 2>&1; then break; fi
    kill -0 "$samba_pid"
    sleep 1
done
wbinfo --ping-dc
apachectl -k start
python3 /fixture/ntlm-server.py > /tmp/ntlm.log 2>&1 &
ntlm_pid=$!
trap 'kill "$ntlm_pid" "$samba_pid" 2>/dev/null || true; apachectl -k stop' EXIT
touch /tmp/realm-ready
wait -n "$samba_pid" "$ntlm_pid"
