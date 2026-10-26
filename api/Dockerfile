FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY . .
USER 1000
EXPOSE 3000
CMD ["node", "server.js"]