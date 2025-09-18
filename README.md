## rrweb-ingest

- REST endpoint для приёма событий rrweb и сохранения в PostgreSQL.
- Документация rrweb: [guide.md](https://github.com/rrweb-io/rrweb/blob/master/guide.md)

### Локальная разработка
1. `cp .env.example .env` (при необходимости подправьте значения)
2. `npm i`
3. Поднимите БД: `docker compose up -d`
4. `npm start`

### Деплой на сервер
- Скопируйте репозиторий на сервер, создайте `.env`, поднимите БД, запустите `node app.js` или через `pm2`.