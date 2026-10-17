FROM node:24.19.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-reportlab && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node server.js pdf-links.js version-registry.js scoring.js report-presentation.js pf-role-model.js answer-details.js stored-report.js work-value-model.js employment-answers.js account-id.js report-pdf.js report-summary.js release-version.js consent.js quota.js ./
COPY --chown=node:node scripts/quota.js ./scripts/quota.js
COPY --chown=node:node report-pdf ./report-pdf
COPY --chown=node:node private ./private
COPY --chown=node:node public ./public
RUN mkdir -p /app/data && chown node:node /app/data && chmod 700 /app/data
USER node
ENV HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/data
EXPOSE 3000
CMD ["node","server.js"]
