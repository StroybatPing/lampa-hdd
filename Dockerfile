# Міст не має жодної залежності, тому образ — це базовий node і два файли.
FROM node:22-alpine

WORKDIR /app
COPY bridge/server.js ./server.js
COPY bridge/config.example.json ./config.example.json

# Конфіг монтується або збирається зі змінних оточення в entrypoint.
ENV LAMPA_BRIDGE_CONFIG=/config/config.json
VOLUME /config

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8091
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:8091/health?token=${LAMPA_TOKEN}" > /dev/null || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "/app/server.js"]
