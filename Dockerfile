# Authoritative container definition maintained in infra/docker/backend/Dockerfile (per ADR-015).
# Mirror copy in backend root enables native root-context container build on Render.com without configuration drift.
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 5000

CMD ["npm", "start"]
