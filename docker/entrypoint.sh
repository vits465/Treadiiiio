#!/bin/bash
set -e

mkdir -p /app/logs /app/data

# Run supervisor to monitor both python ml-service and node engine
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
