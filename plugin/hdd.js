(function () {
  'use strict';

  /**
   * «Зберегти на HDD» — кнопка в картці фільму/серіалу.
   *
   * Lampa вміє лише стрім через TorrServer; постійного зберігання в ній немає.
   * Плагін питає наш міст (lampa-bridge), той шукає роздачі у власному Jackett,
   * віддає обране в Transmission, а після завантаження переносить у Медіатеку,
   * звідки фільм бачить Jellyfin.
   *
   * Підключення: Налаштування → Розширення → додати URL цього файлу.
   */

  var VERSION = '1.6.0';

  var PORT = 8091;
  var found = '';

  function storage(key, def) {
    return window.Lampa && Lampa.Storage ? Lampa.Storage.get(key, def) : def;
  }

  /** Адреса, з якої завантажився сам плагін. */
  function scriptSrc() {
    var src = (document.currentScript && document.currentScript.src) || '';
    if (!src) {
      // Lampa вантажить плагіни доданим <script>, і currentScript у момент
      // виконання буває порожній — тоді шукаємо себе в DOM.
      var tags = document.querySelectorAll('script[src*="hdd.js"]');
      if (tags.length) src = tags[tags.length - 1].src;
    }
    return src;
  }

  function scriptHost() {
    try {
      var a = document.createElement('a');
      a.href = scriptSrc();
      return a.hostname || '';
    } catch (e) {
      return '';
    }
  }

  /**
   * Ключ можна не вбивати в поле пультом, а дописати прямо в адресу плагіна:
   *   …/hdd.js?token=xxxx
   * Тоді встановлення й ключ — одна дія.
   */
  function tokenFromSrc() {
    var m = /[?&]token=([^&]+)/.exec(scriptSrc());
    return m ? decodeURIComponent(m[1]) : '';
  }

  /**
   * Плагін віддається по https (інакше Lampa не дасть його встановити), а міст
   * живе в локальній мережі по http. Тому адресу мосту не можна вивести з
   * адреси плагіна — її шукаємо перебором:
   *   1. те, що вписали в Налаштуваннях;
   *   2. знайдене раніше;
   *   3. 127.0.0.1 — коли Lampa відкрита на тому ж компʼютері, що й міст
   *      (Chrome вважає loopback довіреним і не ріже його як mixed content);
   *   4. хост, звідки прийшов плагін, і хост самої сторінки.
   */
  function candidates() {
    var list = [];
    var add = function (url) {
      if (url && list.indexOf(url) === -1) list.push(url.replace(/\/+$/, ''));
    };

    add(storage('hdd_bridge', ''));
    add(found);
    add('http://127.0.0.1:' + PORT);

    // Хости, де мосту бути не може: плагін віддається з CDN, а сторінка — з
    // сайту збірки. Питати їх — це три зайві таймаути перед відповіддю.
    var public_ = /(jsdelivr|githubusercontent|github\.io|unpkg|kinohub|lampa)/i;
    [scriptHost(), location.hostname].forEach(function (host) {
      if (host && !public_.test(host) && host !== 'localhost' && host !== '127.0.0.1') {
        add('http://' + host + ':' + PORT);
      }
    });
    return list;
  }

  /** Ключ доступу до мосту (щоб чужа сторінка не могла нічого підкинути). */
  function withToken(url) {
    var token = storage('hdd_token', '') || tokenFromSrc();
    if (!token) return url;
    return url + (url.indexOf('?') === -1 ? '?' : '&') + 'token=' + encodeURIComponent(token);
  }

  function ping(base) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (!done) {
          done = true;
          reject(new Error('таймаут'));
        }
      }, 2500);

      fetch(withToken(base + '/health'))
        .then(function (r) {
          if (r.status === 401) throw new Error('невірний ключ доступу');
          return r.json();
        })
        .then(function (j) {
          clearTimeout(timer);
          if (done) return;
          done = true;
          j && j.ok ? resolve(base) : reject(new Error('не міст'));
        })
        .catch(function (e) {
          clearTimeout(timer);
          if (done) return;
          done = true;
          reject(e);
        });
    });
  }

  /** Перший кандидат, що відповів. Знайдене запамʼятовуємо на сесію. */
  function bridge() {
    if (found) return Promise.resolve(found);

    var list = candidates();

    return new Promise(function (resolve, reject) {
      var left = list.length;
      if (!left) return reject(new Error('немає кандидатів'));
      var settled = false;

      list.forEach(function (base) {
        ping(base).then(
          function () {
            if (settled) return;
            settled = true;
            found = base;
            console.log('[hdd] міст знайдено:', base);
            resolve(base);
          },
          function () {
            if (!settled && --left === 0) {
              reject(new Error('міст не відповів: ' + list.join(', ')));
            }
          }
        );
      });
    });
  }

  /**
   * Збірки на кшталт LampaUA ховають підпис у другорядних кнопках
   * (span{display:none}), і кнопка виглядає як безіменна іконка. Повертаємо
   * підпис саме нашій кнопці, не чіпаючи решту.
   */
  function injectStyle() {
    if (document.getElementById('hdd-style')) return;
    var css =
      '.full-start__button.view--hdd{width:auto!important;padding:0 1.4em!important;' +
      'display:inline-flex!important;align-items:center}' +
      '.full-start__button.view--hdd span{display:inline-block!important;' +
      'margin-left:.6em;font-size:1.1em;white-space:nowrap}';
    var style = document.createElement('style');
    style.id = 'hdd-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function noty(text) {
    if (window.Lampa && Lampa.Noty) Lampa.Noty.show(text);
  }

  function api(path, options) {
    return bridge()
      .then(function (base) {
        return fetch(withToken(base + path), options);
      })
      .then(function (r) {
        return r.json();
      });
  }

  var LANGS = { ukr: 'укр', rus: 'рос', eng: 'eng' };

  var FILTERS = [
    {
      key: 'hdd_f_quality',
      name: 'Якість',
      options: [
        { value: 'all', title: 'Будь-яка' },
        { value: '2160p', title: '4K · 2160p' },
        { value: '1080p', title: '1080p' },
        { value: '720p', title: '720p' }
      ]
    },
    {
      key: 'hdd_f_lang',
      name: 'Мова',
      options: [
        { value: 'all', title: 'Будь-яка' },
        { value: 'ukr', title: 'Українська' },
        { value: 'rus', title: 'Російська' },
        { value: 'eng', title: 'Оригінал / англійська' }
      ]
    },
    {
      key: 'hdd_f_source',
      name: 'Джерело',
      options: [
        { value: 'all', title: 'Будь-яке' },
        { value: 'Remux', title: 'Remux — без стиснення' },
        { value: 'BDRip', title: 'BDRip' },
        { value: 'WEB-DL', title: 'WEB-DL' }
      ]
    },
    {
      key: 'hdd_sort',
      name: 'Сортування',
      options: [
        { value: 'seeders', title: 'За сідерами' },
        { value: 'size_desc', title: 'За розміром: більші вгорі' },
        { value: 'size_asc', title: 'За розміром: менші вгорі' }
      ]
    }
  ];

  function filterValue(key) {
    return storage(key, key === 'hdd_sort' ? 'seeders' : 'all');
  }

  function filterTitle(f) {
    var value = filterValue(f.key);
    for (var i = 0; i < f.options.length; i++) {
      if (f.options[i].value === value) return f.options[i].title;
    }
    return value;
  }

  /** Рядок під назвою релізу: усе, за чим обирають. */
  function releaseLabel(r) {
    var parts = [];
    if (r.quality) parts.push(r.quality);
    if (r.source) parts.push(r.source);
    parts.push(r.sizeGb + ' ГБ');
    parts.push(r.seeders + ' сід · ' + r.peers + ' пір');
    if (r.langs && r.langs.length) {
      parts.push(
        r.langs
          .map(function (l) {
            return LANGS[l] || l;
          })
          .join('/')
      );
    }
    parts.push(r.tracker);
    return parts.join(' · ');
  }

  function applyFilters(list) {
    var q = filterValue('hdd_f_quality');
    var lang = filterValue('hdd_f_lang');
    var src = filterValue('hdd_f_source');
    var sort = filterValue('hdd_sort');

    var out = list.filter(function (r) {
      if (q !== 'all' && r.quality !== q) return false;
      if (src !== 'all' && r.source !== src) return false;
      if (lang !== 'all' && (r.langs || []).indexOf(lang) === -1) return false;
      return true;
    });

    out.sort(function (a, b) {
      if (sort === 'size_desc') return b.size - a.size;
      if (sort === 'size_asc') return a.size - b.size;
      return b.seeders - a.seeders;
    });

    return out;
  }

  /** Меню фільтрів; після зміни одразу перемальовуємо список. */
  function showFilters(all, info) {
    Lampa.Select.show({
      title: 'Фільтри',
      items: FILTERS.map(function (f) {
        return { title: f.name, subtitle: filterTitle(f), filter: f };
      }).concat([{ title: 'Скинути все', reset: true }]),
      onSelect: function (item) {
        if (item.reset) {
          FILTERS.forEach(function (f) {
            Lampa.Storage.set(f.key, f.key === 'hdd_sort' ? 'seeders' : 'all');
          });
          return showList(all, info);
        }

        var f = item.filter;
        Lampa.Select.show({
          title: f.name,
          items: f.options.map(function (o) {
            return {
              title: (o.value === filterValue(f.key) ? '✓ ' : '') + o.title,
              value: o.value
            };
          }),
          onSelect: function (opt) {
            Lampa.Storage.set(f.key, opt.value);
            showList(all, info);
          },
          onBack: function () {
            showFilters(all, info);
          }
        });
      },
      onBack: function () {
        showList(all, info);
      }
    });
  }

  function showList(all, info) {
    var list = applyFilters(all);

    var items = list.map(function (r) {
      return { title: r.title, subtitle: releaseLabel(r), release: r };
    });

    items.unshift({
      title: '⚙ Фільтри',
      subtitle:
        FILTERS.map(function (f) {
          return f.name + ': ' + filterTitle(f);
        }).join(' · ') +
        '  (показано ' + list.length + ' з ' + all.length + ')',
      filters: true
    });

    if (!list.length) {
      items.push({ title: 'Під ці фільтри нічого не підходить', empty: true });
    }

    Lampa.Select.show({
      title: 'Зберегти на HDD — ' + (info.local || info.original),
      items: items,
      onSelect: function (item) {
        if (item.filters) return showFilters(all, info);
        if (item.empty) return showList(all, info);

        noty('Ставлю в чергу…');
        api('/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            link: item.release.link,
            title: info.local || info.original,
            kind: info.kind
          })
        })
          .then(function (res) {
            if (!res.ok) return noty('Помилка: ' + res.error);
            noty(
              res.torrent.duplicate
                ? 'Уже качається: ' + res.torrent.name
                : 'Качається на HDD: ' + res.torrent.name
            );
          })
          .catch(function (e) {
            noty('Міст недоступний: ' + e.message);
          });

        Lampa.Controller.toggle('full_start');
      },
      onBack: function () {
        Lampa.Controller.toggle('full_start');
      }
    });
  }

  function onPress(movie) {
    var info = cardInfo(movie);
    noty('Шукаю роздачі: ' + (info.original || info.local));

    findReleases(info)
      .then(function (list) {
        if (!list.length) return noty('Нічого не знайшлось у ваших трекерах');
        showList(list, info);
      })
      .catch(function (e) {
        noty('Міст недоступний: ' + e.message);
      });
  }

  var ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M12 3v9m0 0 3.5-3.5M12 12 8.5 8.5" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round"/>' +
    '<rect x="3" y="15" width="18" height="6" rx="2" stroke="currentColor" stroke-width="2"/>' +
    '<circle cx="17.5" cy="18" r="1.1" fill="currentColor"/></svg>';

  /** Список того, що зараз качається. Викликається з Налаштувань. */
  function showStatus() {
    api('/status')
      .then(function (res) {
        var items = (res.torrents || []).map(function (t) {
          return {
            title: t.title || t.name,
            subtitle:
              t.percent + '%' +
              (t.published
                ? ' · у медіатеці'
                : t.percent >= 100
                ? ' · переношу'
                : ' · качається, ' + Math.round((t.speed || 0) / 104858) / 10 + ' МБ/с')
          };
        });
        if (!items.length) items = [{ title: 'Немає активних завантажень' }];
        Lampa.Select.show({ title: 'Завантаження на HDD', items: items, onSelect: function () {}, onBack: function () {} });
      })
      .catch(function (e) {
        noty('Міст недоступний: ' + e.message);
      });
  }

  /** Власний розділ у Налаштуваннях: адреса мосту, ключ, стан і перевірка звʼязку. */
  function addSettings() {
    if (!window.Lampa || !Lampa.SettingsApi) return;

    Lampa.SettingsApi.addComponent({
      component: 'hdd',
      name: 'Зберегти на HDD',
      icon: ICON
    });

    Lampa.SettingsApi.addParam({
      component: 'hdd',
      param: { name: 'hdd_bridge', type: 'input', values: '', default: '' },
      field: {
        name: 'Адреса мосту',
        description: 'Порожньо — шукати автоматично: ' + candidates().join(', ')
      }
    });

    Lampa.SettingsApi.addParam({
      component: 'hdd',
      param: { name: 'hdd_token', type: 'input', values: '', default: '' },
      field: {
        name: 'Ключ доступу',
        description:
          'Той самий, що в конфізі мосту. Можна не вписувати сюди, а дописати ' +
          'в адресу плагіна: …/hdd.js?token=… ' +
          (tokenFromSrc() ? '(зараз узятий з адреси)' : '')
      }
    });

    Lampa.SettingsApi.addParam({
      component: 'hdd',
      param: { name: 'hdd_status', type: 'button' },
      field: { name: 'Стан завантажень', description: 'Що зараз качається і що вже в медіатеці' },
      onChange: showStatus
    });

    Lampa.SettingsApi.addParam({
      component: 'hdd',
      param: { name: 'hdd_check', type: 'button' },
      field: { name: 'Перевірити звʼязок', description: 'Запитати міст і показати відповідь' },
      onChange: function () {
        noty('Шукаю міст: ' + candidates().join(', '));
        api('/health')
          .then(function (r) {
            noty(
              r.ok
                ? 'Міст працює: ' + found + ' · Transmission ' + r.transmission
                : 'Міст відповів помилкою: ' + r.error
            );
          })
          .catch(function (e) {
            noty('Міст недоступний: ' + e.message);
          });
      }
    });
  }

  function start() {
    addSettings();

    if (Lampa.Manifest) {
      Lampa.Manifest.plugins = {
        type: 'other',
        version: VERSION,
        name: 'Зберегти на HDD',
        description: 'Завантаження знайденої роздачі на власний диск через Transmission',
        component: 'hdd'
      };
    }

    Lampa.Listener.follow('full', function (e) {
      if (e.type === 'complite') {
        try {
          addButton(e);
        } catch (err) {
          console.error('[hdd]', err);
        }
      }
    });
    window.__hdd_ready = true;
    console.log('[hdd] плагін ' + VERSION + ' готовий, кандидати:', candidates().join(', '));
  }

  if (window.Lampa && Lampa.Listener) start();
  else document.addEventListener('lampa:start', start);
})();
