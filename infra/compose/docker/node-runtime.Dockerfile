FROM node:24.20.0-bookworm-slim

ARG NPM_REGISTRY=https://registry.npmjs.org/
ENV PNPM_HOME=/home/node/.local/share/pnpm \
    PATH=/home/node/.local/share/pnpm:$PATH \
    npm_config_registry=${NPM_REGISTRY} \
    npm_config_fetch_timeout=600000 \
    npm_config_fetch_retries=5
WORKDIR /workspace

RUN npm install --global pnpm@11.21.0 && chown node:node /workspace
USER node
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY --chown=node:node . .
RUN sed -i "s#^registry=.*#registry=${NPM_REGISTRY}#" .npmrc
RUN pnpm install --frozen-lockfile --trust-lockfile --prefer-offline --ignore-scripts

CMD ["pnpm", "--filter", "@awp/api", "start"]
