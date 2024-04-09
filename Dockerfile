FROM node:20.9.0

WORKDIR /app

COPY package*.json ./
#RUN npm install
COPY . .

EXPOSE 5000

CMD ["sh", "-c", "if [ \"$NODE_ENV\" = \"development\" ]; then npm run dev; else npm run build && npm run start; fi"]