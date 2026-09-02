# lampa-hdd

Зберігання фільмів на власний диск прямо з [Lampa](https://github.com/yumata/lampa).

Lampa вміє **дивитися** торенти через TorrServer, але не вміє їх **зберігати**:
кеш TorrServer — кільцевий буфер, а не бібліотека. Цей проєкт додає в картку
фільму кнопку «Зберегти на HDD»: пошук роздач у власному Jackett, завантаження
через Transmission і автоматичний перенос готового файлу в медіатеку, звідки
його бачить Jellyfin (Plex/Emby — так само, це просто тека).

```
   Lampa (будь-яка збірка, у т.ч. LampaUA)
     │  плагін hdd.js — кнопка в картці фільму
     ▼
   lampa-bridge (Node, без залежностей)
     │                        │
     │ пошук                  │ завантаження
     ▼                        ▼
   Jackett ──────────────► Transmission
                              │  100% готово
                              ▼
                    Медіатека/Фільми ──► Jellyfin (автоскан)
```

Перенос робиться через `torrent-set-location` з `move: true` — у межах одного
тому це миттєвий rename, копії немає, **роздача не рветься**.

## Що потрібно

- macOS або Linux, Node 18+
- [Transmission](https://transmissionbt.com/) з увімкненим RPC (типово :9091)
- [Jackett](https://github.com/Jackett/Jackett) — свої трекери, свій API-ключ
- будь-який веб-сервер, щоб віддати `plugin/hdd.js` у мережу (у прикладі Caddy)
- за бажанням: [TorrServer](https://github.com/YouROK/TorrServer) для миттєвого
  перегляду й Jellyfin для бібліотеки

## Встановлення

```bash
git clone https://github.com/<user>/lampa-hdd.git
cd lampa-hdd
cp bridge/config.example.json bridge/config.json
$EDITOR bridge/config.json      # шляхи, ключ Jackett, ключ Jellyfin
node bridge/server.js
```

`install.sh` робить те саме плюс качає TorrServer і Jackett та реєструє
launchd-агенти на macOS:

```bash
./install.sh
```

Далі в Lampa: **Налаштування → Розширення → додати за URL**
`http://<адреса-сервера>:8095/hdd.js`

## Важливо: HTTP і HTTPS

Плагін звертається до мосту по HTTP. Якщо Lampa відкрита з **https**-адреси
(наприклад публічний сайт збірки), браузер заблокує такий запит як mixed
content. Робочі варіанти:

- відкривати Lampa з локальної http-адреси (свій хостинг статики — див.
  `Caddyfile.example`);
- або Android-застосунок Lampa, де webview дозволяє mixed content;
- або поставити мосту сертифікат і зробити його https.

## API мосту

| Метод | Маршрут | Що робить |
|---|---|---|
| GET | `/health` | версія Transmission, поточна тека завантажень |
| GET | `/search?title=&year=&kind=` | пошук у Jackett, відсортований за сідерами |
| POST | `/save` `{link,title,kind}` | віддає роздачу в Transmission |
| GET | `/status` | стан наглядуваних торентів |
| POST | `/publish` | примусово перенести готові в медіатеку |

`kind` — `movie` або `series`, від нього залежить тека призначення.

## Конфігурація

`bridge/config.json` (у git не потрапляє — там ваші ключі):

| Поле | Призначення |
|---|---|
| `port` | порт мосту, типово 8091 |
| `transmissionRpc` | адреса RPC Transmission |
| `downloadDir` | куди качати (тимчасова тека роздач) |
| `library.movie` / `library.series` | куди переносити готове |
| `jackett.url` / `jackett.apiKey` | свій Jackett |
| `jellyfin.url` / `jellyfin.apiKey` | необов'язково: автоскан після переносу |
| `pollSeconds` | як часто перевіряти готовність, типово 60 с |

## Чому не просто TorrServer

TorrServer чудовий для «подивитись зараз», але його кеш обмежений розміром і
затирається, імена файлів у ньому службові, і жоден медіасервер такої теки не
розпізнає. Для бібліотеки потрібен звичайний торент-клієнт із нормальними
іменами файлів — тому Transmission, а TorrServer лишається для стріму.

## Ліцензія

MIT
