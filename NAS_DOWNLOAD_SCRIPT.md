# NAS Download Script

The Mac is serving the built files at:
**http://192.168.200.107:8888/**

## Run this on the NAS (via SSH or console):

```bash
# Create the web folder
mkdir -p /volume1/web/customer-flow

# Download all files
cd /volume1/web/customer-flow
curl -s http://192.168.200.107:8888/index.html -o index.html
curl -s http://192.168.200.107:8888/favicon.svg -o favicon.svg
mkdir -p assets
curl -s http://192.168.200.107:8888/assets/index-CXsmQols.js -o assets/index-CXsmQols.js
curl -s http://192.168.200.107:8888/assets/index-BExz-ptp.css -o assets/index-BExz-ptp.css
```

## Or use this one-liner:

```bash
mkdir -p /volume1/web/customer-flow/assets && cd /volume1/web/customer-flow && \
curl -s http://192.168.200.107:8888/index.html -o index.html && \
curl -s http://192.168.200.107:8888/favicon.svg -o favicon.svg && \
curl -s http://192.168.200.107:8888/assets/index-CXsmQols.js -o assets/index-CXsmQols.js && \
curl -s http://192.168.200.107:8888/assets/index-BExz-ptp.css -o assets/index-BExz-ptp.css && \
echo "Done! Files in /volume1/web/customer-flow/"
```

## Then access via:
**http://coucou.myasustor.com/customer-flow/**
