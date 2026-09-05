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

### Docker — увесь серверний бік однією командою

Піднімає міст, Transmission і Jackett; TorrServer — за бажанням.

```bash
git clone https://github.com/StroybatPing/lampa-hdd.git
cd lampa-hdd
cp .env.example .env
openssl rand -hex 16          # згенерований рядок вписати як LAMPA_TOKEN
$EDITOR .env                  # ключ, шляхи до тек, PUID/PGID
docker compose up -d
```

Далі відкрити Jackett на `http://<сервер>:9117`, додати свої трекери,
скопіювати **API Key** у `.env` і перезапустити міст:

```bash
docker compose up -d bridge
```

TorrServer (миттєвий перегляд без завантаження) вмикається окремим профілем:

```bash
docker compose --profile stream up -d
```

### Без Docker

Міст не має залежностей — потрібен лише Node 18+:

```bash
cp bridge/config.example.json bridge/config.json
$EDITOR bridge/config.json      # ключ, шляхи, ключ Jackett
node bridge/server.js
```

Transmission і Jackett у цьому разі ставляться окремо, як вам зручно.

### macOS

`install.sh` качає TorrServer і Jackett, збирає конфіг і реєструє
launchd-агенти, щоб усе піднімалося при вході:

```bash
./install.sh
```

Далі в Lampa: **Налаштування → Розширення → додати за URL**. Адреса плагіна
має бути https, якщо сама Lampa відкрита по https (див. розділ нижче):

```
https://cdn.jsdelivr.net/gh/StroybatPing/lampa-hdd@main/plugin/hdd.js
```

Якщо Lampa відкрита по http (власний локальний хостинг збірки) — годиться й
`http://<адреса-сервера>:8095/hdd.js`.

## Важливо: HTTP і HTTPS

Дві різні речі, і їх легко переплутати.

**Сам файл плагіна має віддаватися по HTTPS**, якщо Lampa відкрита з
https-адреси. Це не примха збірки, а ядро Lampa:

```js
window.location.protocol == 'https:' ? u.replace(/^(http:\/\/|https:\/\/)/, 'https://') : u
```

Адресу будь-якого плагіна воно перепише на `https://`, тож `http://…/hdd.js`
просто не завантажиться. Тому плагін ставлять із https-хостингу (GitHub Pages,
jsDelivr, власний домен), а не з локального веб-сервера.

**Міст може лишатися HTTP** навіть на https-сторінці:

- `http://127.0.0.1:8091` — Chrome вважає loopback довіреним джерелом і не
  ріже його як mixed content (працює, коли Lampa відкрита на тому ж
  компʼютері, де стоїть міст);
- в Android-застосунку LAMPA — будь-яка http-адреса, бо там
  `WebSettings.MIXED_CONTENT_ALWAYS_ALLOW`
  ([SysView.kt](https://github.com/lampa-app/LAMPA/blob/main/app/src/main/java/top/rootu/lampa/browser/SysView.kt));
- в іншому браузері з іншої машини — тільки якщо дати мосту власний
  сертифікат.

Плагін сам перебирає кандидатів (`127.0.0.1`, хост плагіна, хост сторінки) і
запамʼятовує той, що відповів. Адресу можна задати вручну:
**Налаштування → Зберегти на HDD → Адреса мосту**.

## Ключ доступу — не пропускайте цей крок

Міст мусить віддавати `Access-Control-Allow-Origin: *`, бо Lampa відкрита на
чужому домені. Без ключа це означає, що **будь-яка сторінка у вашому браузері**
може підкинути торент у ваш Transmission, і будь-хто у вашій мережі теж.

Тому задайте `token` (у `.env` як `LAMPA_TOKEN` або в `bridge/config.json`) і
впишіть той самий рядок у Lampa: **Налаштування → Зберегти на HDD → Ключ
доступу**. Плагін додає його до кожного запиту; без ключа міст відповідає 401.

Порожній `token` лишає міст відкритим — при старті він про це попереджає в лог.

## API мосту

| Метод | Маршрут | Що робить |
|---|---|---|
| GET | `/health` | версія Transmission, поточна тека завантажень |
| GET | `/search?title=&year=&kind=` | пошук у Jackett, відсортований за сідерами |
| POST | `/save` `{link,title,kind}` | віддає роздачу в Transmission |
| GET | `/status` | стан наглядуваних торентів |
| POST | `/publish` | примусово перенести готові в медіатеку |

`kind` — `movie` або `series`, від нього залежить тека призначення.
Ключ передається як `?token=…` або заголовком `X-Lampa-Token`.

## Конфігурація

`bridge/config.json` (у git не потрапляє — там ваші ключі):

| Поле | Призначення |
|---|---|
| `port` | порт мосту, типово 8091 |
| `bind` | інтерфейс, типово `0.0.0.0` (для телевізорів потрібна мережа) |
| `token` | ключ доступу; порожньо — міст відкритий |
| `transmissionRpc` | адреса RPC Transmission |
| `autostart` | піднімати закритий Transmission на дію власника (тільки macOS) |
| `transmissionApp` | який застосунок піднімати, якщо `autostart` увімкнено |
| `downloadDir` | куди качати (тимчасова тека роздач) |
| `library.movie` / `library.series` | куди переносити готове |
| `jackett.url` / `jackett.apiKey` | свій Jackett |
| `jellyfin.url` / `jellyfin.apiKey` | необов'язково: автоскан після переносу |
| `pollSeconds` | як часто перевіряти готовність, типово 60 с |

## Transmission можна закривати

Міст піднімає його сам, коли ви натискаєте «Зберегти на HDD» — за секунду.
Фоновий наглядач за готовими завантаженнями цього НЕ робить: якщо застосунок
закритий, він мовчки чекає наступного разу. Інакше клієнт вмикався б сам
щохвилини, скільки б його не закривали.

## Чому не просто TorrServer

TorrServer чудовий для «подивитись зараз», але його кеш обмежений розміром і
затирається, імена файлів у ньому службові, і жоден медіасервер такої теки не
розпізнає. Для бібліотеки потрібен звичайний торент-клієнт із нормальними
іменами файлів — тому Transmission, а TorrServer лишається для стріму.

## Ліцензія

MIT
