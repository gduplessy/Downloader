FROM rust:1.93.1-bookworm@sha256:7c4ae649a84014c467d79319bbf17ce2632ae8b8be123ac2fb2ea5be46823f31
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    samba samba-ad-dc samba-ad-provision winbind krb5-user apache2 libapache2-mod-auth-gssapi \
    libcurl4-openssl-dev libssl-dev libnghttp2-dev libkrb5-dev \
    pkg-config python3 ca-certificates && rm -rf /var/lib/apt/lists/*
RUN apt-get update && apt-get install -y --no-install-recommends libdbus-1-dev && rm -rf /var/lib/apt/lists/*
COPY start.sh ntlm-server.py /fixture/
RUN chmod 755 /fixture/start.sh && a2enmod auth_gssapi
ENTRYPOINT ["/fixture/start.sh"]
