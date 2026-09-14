# Image minimale : le projet n'a aucune dépendance npm, il n'y a donc
# rien à installer — juste le code et Node.
FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY outils ./outils

ENV NODE_ENV=production
ENV HOST=0.0.0.0
EXPOSE 3000

# L'hébergeur impose souvent son port via la variable PORT ; le serveur la lit.
CMD ["node", "src/server.js"]
