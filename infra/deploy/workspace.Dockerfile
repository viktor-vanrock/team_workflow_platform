FROM registry.sberdevices.ru/rndml/devops/dockerfiles/nodejs-runtime-24-20:24.20.0-bookworm-slim

ARG NPM_REGISTRY=https://nexus.sberdevices.ru/repository/npm-proxy/
ENV PNPM_HOME=/home/node/.local/share/pnpm \
    PATH=/home/node/.local/share/pnpm:$PATH \
    npm_config_registry=${NPM_REGISTRY} \
    npm_config_fetch_timeout=600000 \
    npm_config_fetch_retries=5 \
    npm_config_verify_deps_before_run=false
WORKDIR /workspace
RUN npm install --global pnpm@11.21.0 && chown node:node /workspace
USER node
# Explicit source allowlist: deployment secrets and local evidence never enter this image.
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY --chown=node:node apps/ ./apps/
COPY --chown=node:node packages/ ./packages/
COPY --chown=node:node tools/deploy/ ./tools/deploy/
COPY --chown=node:node tsconfig.json tsconfig.base.json ./
RUN pnpm install --frozen-lockfile --trust-lockfile --prefer-offline --ignore-scripts
RUN VITE_AWP_AUTH_MODE=corporate VITE_AWP_API_URL= VITE_AWP_COMPOSITION=qa-jira-gitlab-mattermost-test pnpm --filter @awp/web build
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["pnpm", "--filter", "@awp/api", "start:workspace"]
