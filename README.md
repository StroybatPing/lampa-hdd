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

Далі в Lampa: **Налаштування → Розширення → додати за URL**. Адреса плагіна
має бути https, якщо сама Lampa відкрита по https (див. розділ нижче):

```
https://cdn.jsdelivr.net/gh/<user>/lampa-hdd@main/plugin/hdd.js
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
