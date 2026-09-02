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

  var BRIDGE = (function () {
    // Міст живе на тому ж хості, що й цей плагін, на порту 8091.
    var src = (document.currentScript && document.currentScript.src) || '';
    if (!src) {
      // Lampa вантажить плагіни через додавання <script>, і currentScript у
      // момент виконання може бути порожній — тоді шукаємо себе в DOM.
      var tags = document.querySelectorAll('script[src*="hdd.js"]');
      if (tags.length) src = tags[tags.length - 1].src;
    }
    try {
      var a = document.createElement('a');
      a.href = src || location.href;
      if (a.hostname) return 'http://' + a.hostname + ':8091';
    } catch (e) {}
    return 'http://' + location.hostname + ':8091';
  })();

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
    return fetch(BRIDGE + path, options).then(function (r) {
      return r.json();
    });
  }

  function sizeLabel(item) {
    return item.sizeGb + ' ГБ · ' + item.seeders + ' сідерів · ' + item.tracker;
  }

  function cardInfo(movie) {
    var isSeries = !!(movie.name || movie.first_air_date || movie.number_of_seasons);
    return {
      kind: isSeries ? 'series' : 'movie',
      original: movie.original_title || movie.original_name || '',
      local: movie.title || movie.name || '',
      year: String(movie.release_date || movie.first_air_date || '').slice(0, 4)
    };
  }

  /** Пошук: спершу оригінальною назвою (трекери індексують саме її), потім локальною. */
  function findReleases(info) {
    var q = function (title) {
      return api(
        '/search?title=' +
          encodeURIComponent(title) +
          '&year=' +
          encodeURIComponent(info.year) +
          '&kind=' +
          info.kind
      );
    };

    return q(info.original || info.local).then(function (res) {
      if (res.ok && res.results.length) return res.results;
      if (!info.original || info.original === info.local) return [];
      return q(info.local).then(function (r2) {
        return r2.ok ? r2.results : [];
      });
    });
  }

  function showStatus() {
    api('/status').then(function (res) {
      var items = (res.torrents || []).map(function (t) {
        return {
          title: t.title || t.name,
          subtitle:
            t.percent + '%' +
            (t.published ? ' · у медіатеці' : t.percent >= 100 ? ' · переношу' : ' · качається')
        };
      });
      if (!items.length) items = [{ title: 'Немає активних завантажень', subtitle: '' }];

      Lampa.Select.show({
        title: 'Завантаження на HDD',
        items: items,
        onSelect: function () {
          Lampa.Controller.toggle('full_start');
        },
        onBack: function () {
          Lampa.Controller.toggle('full_start');
        }
      });
    });
  }

  function onPress(movie) {
    var info = cardInfo(movie);
    noty('Шукаю роздачі: ' + (info.original || info.local));

    findReleases(info)
      .then(function (list) {
        if (!list.length) return noty('Нічого не знайшлось у ваших трекерах');

        var items = list.map(function (r) {
          return { title: r.title, subtitle: sizeLabel(r), release: r };
        });
        items.unshift({ title: '▸ Стан завантажень', subtitle: '', status: true });

        Lampa.Select.show({
          title: 'Зберегти на HDD — ' + (info.local || info.original),
          items: items,
          onSelect: function (item) {
            if (item.status) return showStatus();

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
      })
      .catch(function (e) {
        noty('Міст недоступний: ' + e.message);
      });
  }

  function addButton(e) {
    var render = e.object.activity.render();
    if (render.find('.view--hdd').length) return;
    injectStyle();

    var button = $(
      '<div class="full-start__button selector view--hdd">' +
        // стрілка вниз у диск — «завантажити до себе»
        '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M12 3v9m0 0 3.5-3.5M12 12 8.5 8.5" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round"/>' +
        '<rect x="3" y="15" width="18" height="6" rx="2" stroke="currentColor" stroke-width="2"/>' +
        '<circle cx="17.5" cy="18" r="1.1" fill="currentColor"/>' +
        '</svg>' +
        '<span>Зберегти на HDD</span>' +
        '</div>'
    );

    button.on('hover:enter', function () {
      onPress(e.data.movie);
    });

    // Класти поруч із «Торренти» не можна: у збірці LampaUA другорядні кнопки
    // лежать у .buttons--container з класом hide, і кнопка виходить нульового
    // розміру. Шукаємо перший ВИДИМИЙ контейнер кнопок.
    var container = render
      .find('.full-start-new__buttons, .full-start__buttons, .buttons--container')
      .filter(function () {
        return !$(this).hasClass('hide');
      })
      .first();

    if (container.length) container.append(button);
    else render.find('.view--torrent').after(button);
  }

  function start() {
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
    console.log('[hdd] плагін готовий, міст:', BRIDGE);
  }

  if (window.Lampa && Lampa.Listener) start();
  else document.addEventListener('lampa:start', start);
})();
