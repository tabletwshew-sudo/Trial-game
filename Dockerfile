# For Fly.io, Railway, a school server, or any Docker host.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci
COPY packages packages
RUN npm run build
ENV PORT=8080 NODE_ENV=production
EXPOSE 8080
CMD ["npm", "start"]
