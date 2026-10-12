FROM node:24.19.0-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node server.js scoring.js report-presentation.js pf-role-model.js answer-details.js stored-report.js work-value-model.js employment-answers.js account-id.js ./
COPY --chown=node:node private ./private
COPY --chown=node:node public ./public
RUN mkdir -p /app/data && chown node:node /app/data && chmod 700 /app/data
USER node
ENV HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/data
EXPOSE 3000
CMD ["node","server.js"]
